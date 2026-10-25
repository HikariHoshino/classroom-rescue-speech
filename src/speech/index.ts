// 语音模块对外入口（契约见《开发对齐说明》第五节）。
// - onSegment 只发送已确认片段；同一 id 可能再次发送（修正），调用方按 id 覆盖。
// - startSpeech 不抛异常：开始失败通过 onStatus({status:"error"}) 报告，并已释放资源。
// - stopSpeech 可重复调用；最多等待最终转写 5 秒，未等到时 stopped 事件附带提示。
// - 旧会话被停止后，其回调不会再写入任何数据。
import type { InputMode, Segment, SpeechEvent, SpeechStatus } from "../../shared/types";
import { startDemo } from "./demo";
import { startLive } from "./live";
import type { Runner, RunnerContext } from "./runner";

export interface StartSpeechOptions {
  sessionId: string;
  mode: InputMode;
  onSegment: (sessionId: string, item: Segment) => void;
  onStatus: (event: SpeechEvent) => void;
}

interface Session {
  id: string;
  alive: boolean;
  runner?: Runner;
  starting?: Promise<Runner>;
  closing?: Promise<void>;
  report(status: SpeechStatus, message?: string): void;
}

let current: Session | null = null;

function shutdown(s: Session, kind: "stop" | "error" | "finish", message?: string): Promise<void> {
  s.closing ??= (async () => {
    if (kind === "stop") s.report("stopping");
    const runner = s.runner ?? (await s.starting?.catch(() => undefined));
    const complete = runner ? await runner.stop().catch(() => false) : true;
    s.alive = false;
    if (current === s) current = null;
    if (kind === "error") s.report("error", message);
    else s.report("stopped", message ?? (complete ? undefined : "停止时未等到最终转写，文字可能不完整"));
  })();
  return s.closing;
}

export async function startSpeech(options: StartSpeechOptions): Promise<void> {
  while (current) {
    if (current.id === options.sessionId && !current.closing) return; // 重复点击开始
    await stopSpeech();
  }

  let finalSent = false;
  const s: Session = {
    id: options.sessionId,
    alive: true,
    report(status, message) {
      if (finalSent) return;
      if (status === "stopped" || status === "error") finalSent = true;
      options.onStatus({ sessionId: options.sessionId, status, ...(message ? { message } : {}) });
    },
  };
  current = s;

  const ctx: RunnerContext = {
    emit(seg) {
      if (s.alive) options.onSegment(options.sessionId, { ...seg });
    },
    fail(message) {
      void shutdown(s, "error", message);
    },
    finish(message) {
      void shutdown(s, "finish", message);
    },
  };

  s.report("starting");
  s.starting = options.mode === "live" ? startLive(ctx) : startDemo(ctx);
  try {
    s.runner = await s.starting;
  } catch (e) {
    s.alive = false;
    if (current === s) current = null;
    if (!s.closing) s.report("error", (e as Error)?.message || "启动转写失败");
    return;
  }
  if (!s.closing) s.report("recording", s.runner.notice);
}

export async function stopSpeech(): Promise<void> {
  if (current) await shutdown(current, "stop");
}
