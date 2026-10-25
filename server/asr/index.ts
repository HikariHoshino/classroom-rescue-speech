// ASR 语音路由（唯一责任人：2号）
// 本文件当前为空壳：只提供注册函数与状态占位，未接入真实 ASR 服务。
// 2号在此实现：/ws/asr WebSocket 音频转发、服务商鉴权（密钥仅读 process.env）、
// 结果标准化为 Segment 后经回调交给前端。
import type { Express } from "express";
import type { Server as HttpServer } from "node:http";

/**
 * 注册 ASR 相关路由与 WebSocket。
 * @param app    Express 应用实例（挂载 /api 下的 HTTP 路由）
 * @param server HTTP 服务器实例（用于挂载 /ws/asr WebSocket）
 */
export function registerAsrRoutes(app: Express, _server: HttpServer): void {
  // TODO(2号)：在此挂载 WebSocket /ws/asr，内部消息协议自行封装。
  app.get("/api/asr/status", (_req, res) => {
    res.json({
      ok: false,
      message: "实时 ASR 尚未接入（2号开发中），当前为骨架占位",
    });
  });
}
