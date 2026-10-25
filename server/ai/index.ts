// AI 路由（唯一责任人：3号）
// 本文件当前为占位实现：始终返回 resultMode="extract" 的原文整理占位结果，
// 未调用任何真实模型。3号在此基础上接入 LLM（15 秒上限，超时回退原文整理）。
import type { Express, Request, Response } from "express";
import type {
  ApiError,
  NotesResponse,
  RescueRequest,
  RescueResponse,
  Segment,
} from "../../shared/types.js";

function badRequest(res: Response, code: string, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(400).json(body);
}

function isSegment(v: unknown): v is Segment {
  const s = v as Segment;
  return (
    !!s &&
    typeof s.id === "string" &&
    typeof s.startMs === "number" &&
    typeof s.endMs === "number" &&
    typeof s.text === "string"
  );
}

/**
 * 注册 AI 相关 HTTP 路由。
 * @param app Express 应用实例
 * 挂载：POST /api/rescue（RescueRequest -> RescueResponse）
 *       POST /api/notes（{ sessionId, segments } -> NotesResponse）
 */
export function registerAiRoutes(app: Express): void {
  app.post("/api/rescue", (req: Request, res: Response) => {
    const body = req.body as Partial<RescueRequest>;
    if (
      !body ||
      typeof body.sessionId !== "string" ||
      typeof body.capturedAtMs !== "number" ||
      typeof body.fromMs !== "number" ||
      typeof body.toMs !== "number" ||
      !Array.isArray(body.segments) ||
      !body.segments.every(isSegment)
    ) {
      badRequest(res, "invalid_request", "请求字段缺失或格式错误");
      return;
    }
    if (body.segments.length === 0) {
      badRequest(res, "no_transcript", "最近2分钟暂无转写");
      return;
    }

    // TODO(3号)：接入真实模型；下方为原文整理占位，未使用 AI。
    const segs = body.segments;
    const joined = segs.map((s) => s.text).join("");
    const latestSeg = segs[segs.length - 1];
    const response: RescueResponse = {
      sessionId: body.sessionId,
      resultMode: "extract",
      data: {
        missed:
          joined.length > 0
            ? `【占位·原文整理】窗口内原文：${joined.slice(0, 120)}${joined.length > 120 ? "…" : ""}`
            : "现有转写不足以判断",
        topic: "【占位·原文整理】主题提炼待 3号 接入模型",
        latest: `【占位·原文整理】最新片段：${latestSeg.text.slice(0, 80)}`,
        evidenceIds: segs.map((s) => s.id),
      },
    };
    res.json(response);
  });

  app.post("/api/notes", (req: Request, res: Response) => {
    const body = req.body as { sessionId?: unknown; segments?: unknown };
    if (
      !body ||
      typeof body.sessionId !== "string" ||
      !Array.isArray(body.segments) ||
      !body.segments.every(isSegment)
    ) {
      badRequest(res, "invalid_request", "请求字段缺失或格式错误");
      return;
    }
    if (body.segments.length === 0) {
      badRequest(res, "no_transcript", "本节课暂无转写内容");
      return;
    }

    // TODO(3号)：接入真实模型；下方为原文整理占位，未使用 AI。
    const segs = body.segments;
    const lines = segs
      .map((s) => {
        const mm = String(Math.floor(s.startMs / 60000)).padStart(2, "0");
        const ss = String(Math.floor((s.startMs % 60000) / 1000)).padStart(2, "0");
        return `- [${mm}:${ss}] ${s.text}`;
      })
      .join("\n");
    const response: NotesResponse = {
      sessionId: body.sessionId,
      resultMode: "extract",
      markdown: [
        "# 课堂笔记（占位·原文整理，未接入 AI）",
        "",
        "## 课堂主题",
        "现有转写不足以判断",
        "",
        "## 知识要点",
        lines,
        "",
        "## 疑似考点及原句",
        "（待 3号 接入后生成）",
        "",
        "## 待确认内容",
        "（待 3号 接入后生成）",
      ].join("\n"),
    };
    res.json(response);
  });
}
