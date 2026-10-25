// 后端启动入口（唯一责任人：1号）
// 端口 3001；挂载 2号 ASR 路由与 3号 AI 路由的注册函数。
import express from "express";
import { createServer } from "node:http";
import { registerAsrRoutes } from "./asr/index.js";
import { registerAiRoutes } from "./ai/index.js";
import type { ApiError } from "../shared/types.js";

const PORT = 3001;

const app = express();
app.use(express.json({ limit: "1mb" }));

// 存活检查：只表示后端进程存活，不代表 ASR 或 AI 可用
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// 2号：ASR 语音路由注册（含 /ws/asr WebSocket）
const httpServer = createServer(app);
registerAsrRoutes(app, httpServer);

// 3号：AI 路由注册（/api/rescue、/api/notes）
registerAiRoutes(app);

// 统一错误兜底：不返回密钥或内部堆栈
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const body: ApiError = {
      error: { code: "internal_error", message: "服务器内部错误" },
    };
    if (!res.headersSent) res.status(500).json(body);
    if (err) console.error("[server] unhandled error:", err);
  },
);

httpServer.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
