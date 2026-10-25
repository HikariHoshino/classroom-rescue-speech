// 全局状态与模块连接（唯一责任人：1号）
// segments 唯一数据来源；2号经回调写入，4号只读，3号请求使用本文件快照。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InputMode,
  RescueResult,
  Segment,
  SpeechEvent,
  SpeechStatus,
} from "../shared/types";
import { ApiRequestError, postNotes, postRescue } from "./api";
import { startSpeech, stopSpeech } from "./speech";
import { detectExamHits } from "./radar";
import { TopBar } from "./components/TopBar";
import { TranscriptPanel } from "./components/TranscriptPanel";
import { RescuePanel } from "./components/RescuePanel";
import { ExamRadar, type ResolvedExamHit } from "./components/ExamRadar";
import { NotesPanel } from "./components/NotesPanel";

const RESCUE_WINDOW_MS = 120_000; // 最近 2 分钟
const CONTEXT_BEFORE_MS = 30_000; // 窗口前最多 30 秒上下文

function newSessionId(): string {
  return `class-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface RescueState {
  loading: boolean;
  result: RescueResult | null;
  resultMode: "ai" | "extract" | null;
  error: string | null;
  windowRange: { fromMs: number; toMs: number } | null;
}

interface NotesState {
  loading: boolean;
  markdown: string | null;
  resultMode: "ai" | "extract" | null;
  recordedAtMs: number | null;
  error: string | null;
}

const EMPTY_RESCUE: RescueState = {
  loading: false,
  result: null,
  resultMode: null,
  error: null,
  windowRange: null,
};

const EMPTY_NOTES: NotesState = {
  loading: false,
  markdown: null,
  resultMode: null,
  recordedAtMs: null,
  error: null,
};

export default function App() {
  // ---- 唯一课堂状态 ----
  const [sessionId, setSessionId] = useState(() => newSessionId());
  const [mode, setMode] = useState<InputMode>("demo");
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [highlightSegmentId, setHighlightSegmentId] = useState<string | null>(null);
  const [rescue, setRescue] = useState<RescueState>(EMPTY_RESCUE);
  const [notes, setNotes] = useState<NotesState>(EMPTY_NOTES);

  // ---- refs：计时与取消控制 ----
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  const startWallClockRef = useRef<number | null>(null);
  const frozenElapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

  // ---- 课堂计时：开始采集/回放时启动，停止后冻结 ----
  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    startWallClockRef.current = Date.now() - frozenElapsedRef.current;
    timerRef.current = setInterval(() => {
      if (startWallClockRef.current === null) return;
      setElapsedMs(Date.now() - startWallClockRef.current);
    }, 250);
  }, []);

  const freezeTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startWallClockRef.current !== null) {
      frozenElapsedRef.current = Date.now() - startWallClockRef.current;
      setElapsedMs(frozenElapsedRef.current);
      startWallClockRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      requestAbortRef.current?.abort();
      void stopSpeech();
    };
  }, []);

  // ---- 片段写入：相同 id 覆盖更新，按 startMs 排序；旧课堂回调直接丢弃 ----
  const handleSegment = useCallback((segSessionId: string, item: Segment) => {
    if (segSessionId !== sessionRef.current) return; // 旧课堂结果不写入新课堂
    setSegments((prev) => {
      const next = prev.filter((s) => s.id !== item.id);
      next.push(item);
      next.sort((a, b) => a.startMs - b.startMs);
      return next;
    });
  }, []);

  const handleSpeechStatus = useCallback(
    (event: SpeechEvent) => {
      if (event.sessionId !== sessionRef.current) return;
      setStatus(event.status);
      setStatusMessage(event.message ?? null);
      if (event.status === "recording") startTimer();
      if (event.status === "stopped" || event.status === "error") freezeTimer();
    },
    [startTimer, freezeTimer],
  );

  // ---- 考点雷达：每次片段新增/修正后对现有片段重算并整体替换 ----
  const examHits = useMemo<ResolvedExamHit[]>(() => {
    const hits = detectExamHits(segments);
    const byId = new Map(segments.map((s) => [s.id, s]));
    return hits.flatMap((hit) => {
      const seg = byId.get(hit.segmentId);
      return seg
        ? [{ ...hit, startMs: seg.startMs, text: seg.text }]
        : [];
    });
  }, [segments]);

  // ---- 控制操作 ----
  const handleStart = useCallback(async () => {
    if (status === "starting" || status === "recording") return; // 禁止重复开始
    setRescue(EMPTY_RESCUE);
    setNotes(EMPTY_NOTES);
    await startSpeech({
      sessionId: sessionRef.current,
      mode,
      onSegment: handleSegment,
      onStatus: handleSpeechStatus,
    });
  }, [mode, status, handleSegment, handleSpeechStatus]);

  const handleStop = useCallback(async () => {
    if (status !== "recording") return;
    setStatus("stopping");
    freezeTimer();
    await stopSpeech();
    // TODO(2号)：实时模式需等待最后片段（最多 5 秒）后再置 stopped
    setStatus("stopped");
  }, [status, freezeTimer]);

  /** 新建课堂：取消进行中请求，清空本节内容，生成新 sessionId */
  const resetSession = useCallback(
    (nextMode: InputMode) => {
      requestAbortRef.current?.abort(); // 取消未完成请求
      requestAbortRef.current = null;
      void stopSpeech();
      freezeTimer();
      frozenElapsedRef.current = 0;

      const nextId = newSessionId();
      sessionRef.current = nextId;
      setSessionId(nextId);
      setMode(nextMode);
      setStatus("idle");
      setStatusMessage(null);
      setSegments([]);
      setElapsedMs(0);
      setHighlightSegmentId(null);
      setRescue(EMPTY_RESCUE);
      setNotes(EMPTY_NOTES);
    },
    [freezeTimer],
  );

  const handleNewSession = useCallback(() => {
    const hasContent = segmentsRef.current.length > 0 || status !== "idle";
    if (
      hasContent &&
      !window.confirm("新建课堂将清空本节内容（笔记请先导出），确认继续？")
    ) {
      return;
    }
    resetSession(mode);
  }, [mode, resetSession, status]);

  /** 切换模式：首次尚未开始直接切换；已有课堂按停止+新建课堂处理 */
  const handleSelectMode = useCallback(
    (nextMode: InputMode) => {
      if (nextMode === mode) return;
      if (status === "idle") {
        setMode(nextMode);
        return;
      }
      if (
        !window.confirm(
          "切换模式将停止当前课堂并新建课堂（实时与回放内容不混用），确认继续？",
        )
      ) {
        return;
      }
      resetSession(nextMode);
    },
    [mode, status, resetSession],
  );

  // ---- 走神急救：冻结快照，截取最近 120 秒窗口 + 前 30 秒上下文 ----
  const doRescue = useCallback(async () => {
    if (rescue.loading) return; // 独立加载状态，禁止重复请求
    const capturedAtMs = elapsedMs;
    const fromMs = Math.max(0, capturedAtMs - RESCUE_WINDOW_MS);
    const snapshot = segmentsRef.current;
    const windowSegments = snapshot.filter(
      (s) => s.endMs > fromMs && s.startMs < capturedAtMs,
    );
    const ctxFrom = Math.max(0, fromMs - CONTEXT_BEFORE_MS);
    const contextSegments = snapshot.filter(
      (s) => s.endMs > ctxFrom && s.startMs < fromMs,
    );

    const currentSession = sessionRef.current;
    if (windowSegments.length === 0) {
      setRescue({
        ...EMPTY_RESCUE,
        error: "最近2分钟暂无转写",
        windowRange: { fromMs, toMs: capturedAtMs },
      });
      return;
    }

    const controller = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;

    setRescue((prev) => ({
      ...EMPTY_RESCUE,
      loading: true,
      result: prev.result,
      resultMode: prev.resultMode,
      windowRange: { fromMs, toMs: capturedAtMs },
    }));

    try {
      const res = await postRescue(
        {
          sessionId: currentSession,
          capturedAtMs,
          fromMs,
          toMs: capturedAtMs,
          segments: windowSegments,
          contextSegments,
        },
        controller.signal,
      );
      if (currentSession !== sessionRef.current) return; // 旧课堂响应丢弃
      setRescue({
        loading: false,
        result: res.data,
        resultMode: res.resultMode,
        error: null,
        windowRange: { fromMs, toMs: capturedAtMs },
      });
    } catch (err) {
      if (currentSession !== sessionRef.current) return;
      if (err instanceof ApiRequestError && err.cancelled) return;
      setRescue((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "回溯失败，请重试",
      }));
    }
  }, [elapsedMs, rescue.loading]);

  // ---- 课后笔记：停止完成后提交整节课快照 ----
  const doNotes = useCallback(async () => {
    if (notes.loading || status !== "stopped") return;
    const snapshot = segmentsRef.current;
    if (snapshot.length === 0) return;

    const currentSession = sessionRef.current;
    const recordedAtMs = frozenElapsedRef.current;
    const controller = new AbortController();
    requestAbortRef.current?.abort();
    requestAbortRef.current = controller;

    setNotes({ ...EMPTY_NOTES, loading: true });
    try {
      const res = await postNotes(currentSession, snapshot, controller.signal);
      if (currentSession !== sessionRef.current) return;
      setNotes({
        loading: false,
        markdown: res.markdown,
        resultMode: res.resultMode,
        recordedAtMs,
        error: null,
      });
    } catch (err) {
      if (currentSession !== sessionRef.current) return;
      if (err instanceof ApiRequestError && err.cancelled) return;
      setNotes((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : "生成笔记失败，请重试",
      }));
    }
  }, [notes.loading, status]);

  const handleLocate = useCallback((segmentId: string) => {
    setHighlightSegmentId(segmentId);
  }, []);

  // ---- 派生状态 ----
  const hasText = segments.length > 0;
  const canStart = status === "idle" || status === "error" || status === "stopped";
  const canStop = status === "recording";
  const canRescue =
    (status === "recording" || status === "stopped") && hasText;
  const canGenerateNotes = status === "stopped" && hasText;

  return (
    <div className="app-shell">
      <TopBar
        mode={mode}
        status={status}
        elapsedMs={elapsedMs}
        canStart={canStart}
        canStop={canStop}
        canSelectMode={status === "idle"}
        onSelectMode={handleSelectMode}
        onStart={handleStart}
        onStop={handleStop}
        onNewSession={handleNewSession}
      />
      {statusMessage && (
        <p
          className={
            status === "error" ? "app-error-banner" : "app-notice-banner"
          }
          role="status"
        >
          {statusMessage}
        </p>
      )}
      <main>
        <div className="workspace-grid">
          <TranscriptPanel
            segments={segments}
            highlightSegmentId={highlightSegmentId}
            status={status}
            onStart={canStart ? () => void handleStart() : undefined}
          />
          <div className="radar-column">
            <ExamRadar hits={examHits} onLocate={handleLocate} />
          </div>
        </div>
        <RescuePanel
          canRescue={canRescue}
          loading={rescue.loading}
          result={rescue.result}
          resultMode={rescue.resultMode}
          error={rescue.error}
          windowRange={rescue.windowRange}
          onRescue={() => void doRescue()}
          onRetry={() => void doRescue()}
        />
        <NotesPanel
          canGenerate={canGenerateNotes}
          loading={notes.loading}
          markdown={notes.markdown}
          resultMode={notes.resultMode}
          recordedAtMs={notes.recordedAtMs}
          error={notes.error}
          onGenerate={() => void doNotes()}
          onRetry={() => void doNotes()}
        />
      </main>
    </div>
  );
}
