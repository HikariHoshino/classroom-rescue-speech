// HTTP 调用封装（唯一责任人：1号）
// 统一封装 fetch、错误提示、20 秒超时与请求取消。
// 所有请求校验响应 sessionId；新建课堂后由调用方取消并丢弃旧课堂响应。
import type {
  ApiError,
  NoteSectionsResponse,
  NotesResponse,
  RescueRequest,
  RescueResponse,
  Segment,
} from "../shared/types";

const REQUEST_TIMEOUT_MS = 20_000;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly cancelled: boolean;

  constructor(code: string, message: string, status = 0, cancelled = false) {
    super(message);
    this.code = code;
    this.status = status;
    this.cancelled = cancelled;
  }
}

async function parseErrorBody(res: Response): Promise<ApiRequestError> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (body?.error?.code && body?.error?.message) {
      return new ApiRequestError(body.error.code, body.error.message, res.status);
    }
  } catch {
    // 响应不是 JSON 时走通用错误
  }
  return new ApiRequestError("http_error", `请求失败（HTTP ${res.status}）`, res.status);
}

/**
 * 统一 JSON POST。内部 20 秒超时；外部 signal 取消（新建课堂/切换模式时调用方触发）。
 * 超时与外部取消都会真正中止请求；调用方仍需校验 sessionId 以防取消竞态。
 */
async function postJson<TReq, TRes>(
  path: string,
  body: TReq,
  sessionId: string,
  externalSignal?: AbortSignal,
): Promise<TRes> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  const onExternalAbort = () => timeoutController.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });
    if (!res.ok) throw await parseErrorBody(res);

    const data = (await res.json()) as TRes & { sessionId?: string };
    // 校验响应归属：新建课堂后旧响应直接丢弃
    if (typeof data.sessionId === "string" && data.sessionId !== sessionId) {
      throw new ApiRequestError("stale_session", "旧课堂的响应已丢弃", 0, true);
    }
    return data;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new ApiRequestError("cancelled", "请求已取消", 0, true);
      }
      throw new ApiRequestError("timeout", "请求超时（20秒），请重试");
    }
    throw new ApiRequestError("network_error", "网络异常，请检查后端是否启动");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/** 走神急救：POST /api/rescue */
export function postRescue(
  request: RescueRequest,
  externalSignal?: AbortSignal,
): Promise<RescueResponse> {
  return postJson<RescueRequest, RescueResponse>(
    "/api/rescue",
    request,
    request.sessionId,
    externalSignal,
  );
}

/** 课后笔记：POST /api/notes，segments 为停止完成后的整节课快照 */
export function postNotes(
  sessionId: string,
  segments: Segment[],
  externalSignal?: AbortSignal,
): Promise<NotesResponse> {
  return postJson<{ sessionId: string; segments: Segment[] }, NotesResponse>(
    "/api/notes",
    { sessionId, segments },
    sessionId,
    externalSignal,
  );
}

/** 笔记分节：POST /api/notes/sections，供 4号 的 NotesSectionsPreview 接入 */
export function postNoteSections(
  sessionId: string,
  segments: Segment[],
  externalSignal?: AbortSignal,
): Promise<NoteSectionsResponse> {
  return postJson<{ sessionId: string; segments: Segment[] }, NoteSectionsResponse>(
    "/api/notes/sections",
    { sessionId, segments },
    sessionId,
    externalSignal,
  );
}
