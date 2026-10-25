// 火山引擎「大模型流式语音识别」WebSocket 二进制协议客户端。
// 协议依据：https://www.volcengine.com/docs/6561/1354869 （2026-08-06 版）
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import WebSocket from "ws";

export interface AsrConfig {
  url: string;
  resourceId: string;
  /** 旧版控制台：App Key + Access Key */
  appKey?: string;
  accessKey?: string;
  /** 新版控制台：只需 X-Api-Key */
  apiKey?: string;
}

export interface VolcUtterance {
  text: string;
  start_time: number;
  end_time: number;
  definite?: boolean;
}

/**
 * 读取 .env：
 * - 旧版控制台：ASR_APP_ID = APP ID，ASR_API_KEY = Access Token
 * - 新版控制台：只填 ASR_API_KEY（留空 ASR_APP_ID）
 * - ASR_RESOURCE_ID 默认 volc.bigasr.sauc.duration（1.0 小时版）
 * - ASR_WS_URL 默认双向流式优化版 bigmodel_async
 */
export function readAsrConfig(env: NodeJS.ProcessEnv = process.env): AsrConfig | null {
  const appId = env.ASR_APP_ID?.trim();
  const key = env.ASR_API_KEY?.trim();
  if (!key) return null;
  return {
    url: env.ASR_WS_URL?.trim() || "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async",
    resourceId: env.ASR_RESOURCE_ID?.trim() || "volc.bigasr.sauc.duration",
    ...(appId ? { appKey: appId, accessKey: key } : { apiKey: key }),
  };
}

// ---- 二进制帧 ----
const MSG_FULL_CLIENT = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER = 0b1001;
const MSG_ERROR = 0b1111;
const FLAG_LAST_NO_SEQ = 0b0010;
const SERIAL_NONE = 0b0000;
const SERIAL_JSON = 0b0001;
const GZIP = 0b0001;

function frame(type: number, flags: number, serial: number, payload: Buffer): Buffer {
  const body = gzipSync(payload);
  const head = Buffer.from([0x11, (type << 4) | flags, (serial << 4) | GZIP, 0x00]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([head, size, body]);
}

export function encodeFullRequest(json: unknown): Buffer {
  return frame(MSG_FULL_CLIENT, 0, SERIAL_JSON, Buffer.from(JSON.stringify(json), "utf8"));
}

export function encodeAudio(pcm: Buffer, last: boolean): Buffer {
  return frame(MSG_AUDIO_ONLY, last ? FLAG_LAST_NO_SEQ : 0, SERIAL_NONE, pcm);
}

export type DecodedFrame =
  | { kind: "result"; last: boolean; payload: any }
  | { kind: "error"; code: number; message: string };

export function decodeServerFrame(buf: Buffer): DecodedFrame {
  const headerSize = (buf[0] & 0x0f) * 4;
  const type = buf[1] >> 4;
  const flags = buf[1] & 0x0f;
  const compression = buf[2] & 0x0f;
  let off = headerSize;
  const unzip = (b: Buffer) => (compression === GZIP ? gunzipSync(b) : b);

  if (type === MSG_ERROR) {
    const code = buf.readUInt32BE(off);
    const size = buf.readUInt32BE(off + 4);
    const raw = buf.subarray(off + 8, off + 8 + size);
    let message: string;
    try { message = unzip(raw).toString("utf8"); } catch { message = raw.toString("utf8"); }
    return { kind: "error", code, message };
  }
  if (type !== MSG_FULL_SERVER) {
    return { kind: "error", code: -1, message: `未知消息类型 ${type}` };
  }
  if (flags & 0b0001) off += 4; // sequence
  const size = buf.readUInt32BE(off);
  off += 4;
  const raw = buf.subarray(off, off + size);
  const text = unzip(raw).toString("utf8");
  return { kind: "result", last: (flags & 0b0010) !== 0, payload: text ? JSON.parse(text) : {} };
}

// ---- 一次识别会话 ----
export interface VolcHandlers {
  onResult: (utterances: VolcUtterance[], last: boolean) => void;
  /** code：服务端错误码；-1 表示连接层问题 */
  onError: (code: number, detail: string) => void;
  onClose: () => void;
}

export class VolcAsrStream {
  private ws?: WebSocket;
  private open = false;
  private pending: Buffer[] = [];
  private closed = false;
  logId = "";

  constructor(private config: AsrConfig, private handlers: VolcHandlers) {}

  /** 建连并发送 full client request；握手失败时 reject（带 HTTP 状态码）。 */
  connect(timeoutMs = 10000): Promise<void> {
    const c = this.config;
    const headers: Record<string, string> = {
      "X-Api-Resource-Id": c.resourceId,
      "X-Api-Connect-Id": randomUUID(),
    };
    if (c.apiKey) headers["X-Api-Key"] = c.apiKey;
    else {
      headers["X-Api-App-Key"] = c.appKey!;
      headers["X-Api-Access-Key"] = c.accessKey!;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(c.url, { headers, handshakeTimeout: timeoutMs });
      this.ws = ws;
      let settled = false;
      const fail = (err: Error & { status?: number }) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.on("upgrade", (res) => {
        this.logId = String(res.headers["x-tt-logid"] ?? "");
      });
      ws.on("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          const err = Object.assign(new Error(`HTTP ${res.statusCode} ${body.slice(0, 300)}`), {
            status: res.statusCode,
          });
          fail(err);
          ws.terminate();
        });
      });
      ws.on("open", () => {
        ws.send(
          encodeFullRequest({
            user: { uid: "classroom-rescue" },
            audio: { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 },
            request: {
              model_name: "bigmodel",
              enable_itn: true,
              enable_punc: true,
              show_utterances: true,
              result_type: "full",
              // 二遍识别：VAD 判停后用非流式模型重识别该句，并输出 definite=true
              enable_nonstream: true,
              end_window_size: 800,
            },
          }),
        );
        this.open = true;
        for (const b of this.pending) ws.send(b);
        this.pending = [];
        settled = true;
        resolve();
      });
      ws.on("message", (data: Buffer, isBinary) => {
        if (!isBinary) return;
        let f: DecodedFrame;
        try {
          f = decodeServerFrame(data);
        } catch (e) {
          this.handlers.onError(-1, `响应解析失败: ${(e as Error).message}`);
          return;
        }
        if (f.kind === "error") this.handlers.onError(f.code, f.message);
        else this.handlers.onResult(f.payload?.result?.utterances ?? [], f.last);
      });
      // 握手失败时只走 reject，不再触发运行期回调
      ws.on("error", (e) => {
        if (!settled) fail(e);
        else if (this.open) this.handlers.onError(-1, e.message);
      });
      ws.on("close", () => {
        const wasOpen = this.open;
        this.open = false;
        if (!settled) fail(new Error("连接在握手阶段关闭"));
        if (wasOpen && !this.closed) {
          this.closed = true;
          this.handlers.onClose();
        }
      });
    });
  }

  sendAudio(pcm: Buffer): void {
    const b = encodeAudio(pcm, false);
    if (this.open) this.ws!.send(b);
    else this.pending.push(b);
  }

  /** 发送最后一包（负包），之后服务端会返回 last=true 的最终结果。 */
  finish(): void {
    const b = encodeAudio(Buffer.alloc(0), true);
    if (this.open) this.ws!.send(b);
    else this.pending.push(b);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

/** 服务端错误码 → 面向用户的中文提示（不透传服务商原始响应）。 */
export function describeAsrError(code: number): string {
  switch (code) {
    case 45000001: return "识别请求参数无效";
    case 45000002: return "没有收到有效音频";
    case 45000081: return "识别服务等待音频超时";
    case 45000151: return "音频格式不正确";
    case 55000031: return "识别服务繁忙，请稍后重试";
    case -1: return "识别服务连接异常";
    default:
      return code >= 55000000 && code < 56000000 ? "识别服务内部错误" : `识别服务错误（${code}）`;
  }
}

/** 握手失败 → 中文提示。 */
export function describeConnectError(err: Error & { status?: number }): string {
  if (err.status === 401 || err.status === 403) return "识别服务鉴权失败：检查 .env 中的 ASR 密钥与资源 ID 是否开通";
  if (err.status) return `识别服务拒绝连接（HTTP ${err.status}）`;
  return "无法连接识别服务，请检查网络";
}
