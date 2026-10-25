// 语音模块入口（唯一责任人：2号）
// 固定导出 startSpeech / stopSpeech，契约见 shared/types.ts 注释与 docs/interfaces.md。
// 当前状态：
//   - demo 模式：播放 src/speech/demo-data.ts 的【示例数据】（非真实 ASR）；
//   - live 模式：尚未接入真实 ASR，直接上报 error 状态，不伪装成可用。
import type { InputMode, Segment, SpeechEvent } from "../../shared/types";
import { DEMO_SAMPLES, DEMO_TOTAL_MS } from "./demo-data";

export interface StartSpeechOptions {
  sessionId: string;
  mode: InputMode;
  /** 只发送已确认片段；相同 id 由调用方覆盖更新 */
  onSegment: (sessionId: string, item: Segment) => void;
  onStatus: (event: SpeechEvent) => void;
}

let activeTimers: ReturnType<typeof setTimeout>[] = [];
let activeSessionId: string | null = null;

function clearTimers(): void {
  for (const t of activeTimers) clearTimeout(t);
  activeTimers = [];
}

/**
 * 开始语音输入。
 * - demo：按时间轴回放示例片段（示例数据，非真实识别）；
 * - live：TODO(2号) 采集麦克风，经 /ws/asr 交由后端转发 ASR 服务。
 */
export async function startSpeech(options: StartSpeechOptions): Promise<void> {
  const { sessionId, mode, onSegment, onStatus } = options;

  // 重复开始时先停掉旧会话，保证幂等
  await stopSpeech();
  activeSessionId = sessionId;
  onStatus({ sessionId, status: "starting" });

  if (mode === "live") {
    // TODO(2号)：实时 ASR 尚未接入。开始失败须释放已取得的麦克风资源。
    activeSessionId = null;
    onStatus({
      sessionId,
      status: "error",
      message: "实时语音尚未接入（2号开发中），请改用演示模式",
    });
    return;
  }

  // demo 模式：回放示例数据
  onStatus({ sessionId, status: "recording", message: "示例回放中（非真实 ASR）" });
  for (const sample of DEMO_SAMPLES) {
    const timer = setTimeout(() => {
      if (activeSessionId !== sessionId) return;
      onSegment(sessionId, { ...sample.segment });
    }, sample.emitAtMs);
    activeTimers.push(timer);
  }
  // 回放结束后保持 recording，等待用户手动停止
  const endTimer = setTimeout(() => {
    if (activeSessionId !== sessionId) return;
    onStatus({
      sessionId,
      status: "recording",
      message: "示例回放已播完，可手动停止",
    });
  }, DEMO_TOTAL_MS);
  activeTimers.push(endTimer);
}

/** 停止语音输入。可重复调用且安全返回。 */
export async function stopSpeech(): Promise<void> {
  const sessionId = activeSessionId;
  clearTimers();
  activeSessionId = null;
  // TODO(2号)：实时模式需释放麦克风轨道、WebSocket 连接与定时器，
  // 并等待最终结果（最多 5 秒）后再由上层置为 stopped。
  void sessionId;
}
