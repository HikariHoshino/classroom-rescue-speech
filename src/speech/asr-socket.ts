// 与后端 /ws/asr 的连接。消息协议见 server/asr/index.ts 顶部注释。
import type { Segment } from "../../shared/types";

type ServerMessage =
  | { type: "ready" }
  | { type: "segment"; segment: Segment }
  | { type: "done" }
  | { type: "error"; message: string };

export interface AsrSocket {
  send(pcm: ArrayBuffer): void;
  /** 发送结束标记并等待最终结果；超时返回 false（文字可能不完整）。 */
  end(timeoutMs: number): Promise<boolean>;
  close(): void;
}

export function openAsrSocket(handlers: {
  onSegment: (seg: Segment) => void;
  /** 运行中出错或连接意外断开 */
  onFailure: (message: string) => void;
}): Promise<AsrSocket> {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/asr`);
  ws.binaryType = "arraybuffer";

  let ready = false;
  let finished = false; // 已收到 done 或已主动关闭
  let gotDone = false; // 服务端确认最终结果已全部下发
  let onDone: ((ok: boolean) => void) | null = null;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      finished = true;
      ws.close();
      reject(new Error("连接识别服务超时"));
    }, 12000);

    const fail = (message: string) => {
      if (finished) return;
      finished = true;
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(message));
      } else {
        onDone?.(false);
        handlers.onFailure(message);
      }
    };

    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.type === "ready" && !ready) {
        ready = true;
        clearTimeout(timer);
        resolve(socket);
      } else if (msg.type === "segment") {
        handlers.onSegment(msg.segment);
      } else if (msg.type === "done") {
        finished = true;
        gotDone = true;
        onDone?.(true);
        ws.close();
      } else if (msg.type === "error") {
        fail(msg.message);
      }
    };
    ws.onerror = () => fail("无法连接后端转写通道 /ws/asr");
    ws.onclose = () => fail(ready ? "转写通道已断开" : "后端转写通道连接失败");

    const socket: AsrSocket = {
      send(pcm) {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
      },
      end(timeoutMs) {
        if (finished || ws.readyState !== WebSocket.OPEN) return Promise.resolve(gotDone);
        return new Promise<boolean>((res) => {
          const t = setTimeout(() => {
            onDone = null;
            res(false);
          }, timeoutMs);
          onDone = (ok) => {
            clearTimeout(t);
            res(ok);
          };
          ws.send(JSON.stringify({ type: "end" }));
        });
      },
      close() {
        finished = true;
        ws.close();
      },
    };
  });
}
