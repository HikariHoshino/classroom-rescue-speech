// 语音路由：浏览器 ⇄ /ws/asr ⇄ 火山流式 ASR。密钥只在这里读取，不下发前端。
//
// 内部消息协议（仅 src/speech 使用）：
//   浏览器 → 后端：二进制 = 16kHz/16bit/单声道 PCM；文本 {"type":"end"} = 音频结束
//   后端 → 浏览器：{"type":"ready"} | {"type":"segment","segment":Segment}
//                  | {"type":"done"} | {"type":"error","message":string}
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { SegmentCollector } from "./segments";
import { VolcAsrStream, describeAsrError, describeConnectError, readAsrConfig } from "./volc";

export const ASR_WS_PATH = "/ws/asr";

/** 由 1 号在 server/index.ts 调用：registerAsrRoutes(httpServer) */
export function registerAsrRoutes(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on("upgrade", (req, socket, head) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path !== ASR_WS_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => handleClient(ws));
  });
}

function handleClient(client: WebSocket): void {
  const send = (msg: object) => {
    if (client.readyState === client.OPEN) client.send(JSON.stringify(msg));
  };
  const failClient = (message: string) => {
    send({ type: "error", message });
    client.close();
  };

  const config = readAsrConfig();
  if (!config) {
    failClient("后端未配置识别服务密钥（.env 中的 ASR_API_KEY）");
    return;
  }

  const collector = new SegmentCollector();
  let done = false;
  const upstream = new VolcAsrStream(config, {
    onResult(utterances, last) {
      for (const segment of collector.update(utterances, last)) send({ type: "segment", segment });
      if (last) {
        done = true;
        send({ type: "done" });
        client.close();
        upstream.close();
      }
    },
    onError(code, detail) {
      console.error(`[asr] 服务端错误 code=${code} logid=${upstream.logId} ${detail}`);
      done = true;
      failClient(describeAsrError(code));
      upstream.close();
    },
    onClose() {
      if (!done) failClient("识别服务连接中断");
    },
  });

  client.on("message", (data: Buffer, isBinary) => {
    if (isBinary) {
      upstream.sendAudio(data);
      return;
    }
    try {
      if (JSON.parse(data.toString()).type === "end") upstream.finish();
    } catch {
      /* 忽略无法解析的文本消息 */
    }
  });
  client.on("close", () => {
    done = true;
    upstream.close();
  });

  upstream.connect().then(
    () => {
      console.log(`[asr] 已连接识别服务 logid=${upstream.logId}`);
      send({ type: "ready" });
    },
    (err) => {
      console.error(`[asr] 连接识别服务失败: ${err.message}`);
      done = true;
      failClient(describeConnectError(err));
    },
  );
}
