// AI 路由（唯一责任人：3号）
// 结构：Express 适配层（本文件） ——HTTP——▶ Python 引擎 server/ai/engine/server.py
//
// 为什么不是全部写在 Node 里：
//   1. 回溯/笔记的提示词、结果校验、原文整理放在 Python 引擎里，独立可测（21 个用例）；
//   2. Python 引擎只监听 127.0.0.1:8000，浏览器不直连，密钥只留在后端。
//
// 降级链（任何一级失败都不会让演示黑屏）：
//   Python + 模型正常      -> resultMode="ai"
//   Python 正常、模型不可用 -> Python 内原文整理，resultMode="extract"
//   Python 没启动 / 超时    -> 本目录 extract.ts 本地原文整理，resultMode="extract"
//   没有可用文本            -> 400 no_transcript
import type { Express, Request, Response } from "express";
import { extractNotes, extractRescue } from "./extract.js";
import type {
  ApiError,
  NotesResponse,
  RescueRequest,
  RescueResponse,
  Segment,
} from "../../shared/types.js";

const ENGINE_URL = (process.env.AI_ENGINE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const ENGINE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_ENGINE_TIMEOUT_MS ?? 16000);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 60000 ? raw : 16000;
})();

type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

/**
 * 笔记小节：与 1号 约定后应迁入 shared/types.ts。
 * examStars 只表示「这个知识点在历年 408 真题里出现得多不多」，不代表今年一定考。
 */
export interface NoteSectionDraft {
  id: string;
  title: string;
  points: string[];
  startMs: number;
  segmentIds: string[];
  examStars: 0 | 1 | 2 | 3;
  examBasis: string;
}

export interface SectionsResponse {
  sessionId: string;
  resultMode: "ai" | "extract";
  sections: NoteSectionDraft[];
}

function fail(res: Response, status: number, code: string, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * 防御性归一：剔除空文本、相同 id 覆盖更新、按 startMs 排序、endMs 不小于 startMs。
 * Python 引擎里有一份等价实现，两层都做是为了任一层被绕过时行为仍然一致。
 */
function normalizeSegments(raw: unknown): Segment[] | null {
  if (!Array.isArray(raw)) return null;
  const byId = new Map<string, Segment>();
  for (const item of raw) {
    const segment = item as Partial<Segment> | null;
    if (!segment || typeof segment.id !== "string" || typeof segment.text !== "string") continue;
    const id = segment.id.trim();
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!id || !text) continue;
    if (!isFiniteNumber(segment.startMs) || !isFiniteNumber(segment.endMs)) continue;
    const startMs = Math.max(0, Math.round(segment.startMs));
    const endMs = Math.max(startMs, Math.round(segment.endMs));
    byId.set(id, { id, startMs, endMs, text });
  }
  return [...byId.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

function parseRescue(body: unknown): Parsed<RescueRequest> {
  const raw = body as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "invalid_request", message: "请求体必须是 JSON 对象" };
  }
  if (typeof raw.sessionId !== "string" || raw.sessionId.trim() === "") {
    return { ok: false, code: "invalid_request", message: "缺少 sessionId" };
  }
  if (!isFiniteNumber(raw.capturedAtMs) || !isFiniteNumber(raw.fromMs) || !isFiniteNumber(raw.toMs)) {
    return { ok: false, code: "invalid_request", message: "capturedAtMs / fromMs / toMs 必须是毫秒数" };
  }
  if (raw.fromMs > raw.toMs) {
    return { ok: false, code: "invalid_request", message: "fromMs 不能大于 toMs" };
  }

  const segments = normalizeSegments(raw.segments);
  const contextSegments = normalizeSegments(raw.contextSegments ?? []);
  if (segments === null || contextSegments === null) {
    return { ok: false, code: "invalid_request", message: "segments / contextSegments 必须是数组" };
  }
  if (segments.length === 0 && contextSegments.length === 0) {
    return { ok: false, code: "no_transcript", message: "最近2分钟暂无转写" };
  }

  return {
    ok: true,
    value: {
      sessionId: raw.sessionId.trim(),
      capturedAtMs: Math.max(0, Math.round(raw.capturedAtMs)),
      fromMs: Math.max(0, Math.round(raw.fromMs)),
      toMs: Math.max(0, Math.round(raw.toMs)),
      segments,
      contextSegments,
    },
  };
}

function parseNotes(body: unknown): Parsed<{ sessionId: string; segments: Segment[] }> {
  const raw = body as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: "invalid_request", message: "请求体必须是 JSON 对象" };
  }
  if (typeof raw.sessionId !== "string" || raw.sessionId.trim() === "") {
    return { ok: false, code: "invalid_request", message: "缺少 sessionId" };
  }
  const segments = normalizeSegments(raw.segments);
  if (segments === null) {
    return { ok: false, code: "invalid_request", message: "segments 必须是数组" };
  }
  if (segments.length === 0) {
    return { ok: false, code: "no_transcript", message: "本节课暂无转写内容" };
  }
  return { ok: true, value: { sessionId: raw.sessionId.trim(), segments } };
}

/** 调用 Python 引擎；任何失败都返回 null，由调用方走本地兜底。 */
async function callEngine<T>(path: string, payload: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS);
  try {
    const response = await fetch(`${ENGINE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`[ai] 引擎返回 HTTP ${response.status}，改用本地原文整理`);
      return null;
    }
    return (await response.json()) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    const cause = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
    console.warn(`[ai] 引擎不可达（${cause ?? reason}），改用本地原文整理`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isRescueResponse(value: unknown): value is RescueResponse {
  const body = value as RescueResponse | null;
  return (
    !!body &&
    typeof body.sessionId === "string" &&
    (body.resultMode === "ai" || body.resultMode === "extract") &&
    !!body.data &&
    typeof body.data.missed === "string" &&
    typeof body.data.topic === "string" &&
    typeof body.data.latest === "string" &&
    Array.isArray(body.data.evidenceIds)
  );
}

function isNotesResponse(value: unknown): value is NotesResponse {
  const body = value as NotesResponse | null;
  return (
    !!body &&
    typeof body.sessionId === "string" &&
    (body.resultMode === "ai" || body.resultMode === "extract") &&
    typeof body.markdown === "string" &&
    body.markdown.trim() !== ""
  );
}

function isSectionsResponse(value: unknown): value is SectionsResponse {
  const body = value as SectionsResponse | null;
  return (
    !!body &&
    typeof body.sessionId === "string" &&
    (body.resultMode === "ai" || body.resultMode === "extract") &&
    Array.isArray(body.sections) &&
    body.sections.every(
      (item) =>
        !!item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        Array.isArray(item.points) &&
        Array.isArray(item.segmentIds) &&
        typeof item.examStars === "number",
    )
  );
}

/** 引擎不可用时的最简分节：整节课一段，不假装有知识点星级。 */
function fallbackSections(segments: Segment[]): NoteSectionDraft[] {
  return [
    {
      id: "sec-01",
      title: "课堂内容",
      points: segments.map((segment) => segment.text),
      startMs: segments[0]?.startMs ?? 0,
      segmentIds: segments.map((segment) => segment.id),
      examStars: 0,
      examBasis: "知识库暂不可用",
    },
  ];
}

function guard(res: Response, started: number, route: string, error: unknown): void {
  const elapsed = Date.now() - started;
  console.error(`[ai] ${route} 失败 ${elapsed}ms:`, error);
  fail(res, 502, "ai_unavailable", "回溯服务暂时不可用，请重试");
}

/**
 * 注册 AI 相关 HTTP 路由。
 * 挂载：POST /api/rescue（RescueRequest -> RescueResponse）
 *       POST /api/notes（{ sessionId, segments } -> NotesResponse）
 */
export function registerAiRoutes(app: Express): void {
  app.post("/api/rescue", (req: Request, res: Response) => {
    const started = Date.now();
    void (async () => {
      try {
        const parsed = parseRescue(req.body);
        if (!parsed.ok) {
          fail(res, 400, parsed.code, parsed.message);
          return;
        }
        const request = parsed.value;

        const fromEngine = await callEngine<RescueResponse>("/rescue", request);
        let payload: RescueResponse;
        if (fromEngine && isRescueResponse(fromEngine)) {
          // sessionId 一律以本次请求为准，防止旧课堂结果串场
          payload = { ...fromEngine, sessionId: request.sessionId };
        } else {
          payload = {
            sessionId: request.sessionId,
            resultMode: "extract",
            data: extractRescue(request),
          };
        }
        console.log(
          `[ai] /api/rescue ${Date.now() - started}ms mode=${payload.resultMode} segs=${request.segments.length}`,
        );
        res.json(payload);
      } catch (error) {
        guard(res, started, "/api/rescue", error);
      }
    })();
  });

  app.post("/api/notes", (req: Request, res: Response) => {
    const started = Date.now();
    void (async () => {
      try {
        const parsed = parseNotes(req.body);
        if (!parsed.ok) {
          fail(res, 400, parsed.code, parsed.message);
          return;
        }
        const { sessionId, segments } = parsed.value;

        const fromEngine = await callEngine<NotesResponse>("/notes", { sessionId, segments });
        let payload: NotesResponse;
        if (fromEngine && isNotesResponse(fromEngine)) {
          payload = { ...fromEngine, sessionId };
        } else {
          payload = { sessionId, resultMode: "extract", markdown: extractNotes(sessionId, segments) };
        }
        console.log(
          `[ai] /api/notes ${Date.now() - started}ms mode=${payload.resultMode} segs=${segments.length}`,
        );
        res.json(payload);
      } catch (error) {
        guard(res, started, "/api/notes", error);
      }
    })();
  });

  // 笔记分节：给 4号 的「按知识点勾选 → 存进笔记本」用，与 /api/notes 并存、互不改动
  app.post("/api/notes/sections", (req: Request, res: Response) => {
    const started = Date.now();
    void (async () => {
      try {
        const parsed = parseNotes(req.body);
        if (!parsed.ok) {
          fail(res, 400, parsed.code, parsed.message);
          return;
        }
        const { sessionId, segments } = parsed.value;

        const fromEngine = await callEngine<SectionsResponse>("/sections", { sessionId, segments });
        const payload: SectionsResponse =
          fromEngine && isSectionsResponse(fromEngine)
            ? { ...fromEngine, sessionId }
            : { sessionId, resultMode: "extract", sections: fallbackSections(segments) };

        console.log(
          `[ai] /api/notes/sections ${Date.now() - started}ms mode=${payload.resultMode} sections=${payload.sections.length}`,
        );
        res.json(payload);
      } catch (error) {
        guard(res, started, "/api/notes/sections", error);
      }
    })();
  });
}
