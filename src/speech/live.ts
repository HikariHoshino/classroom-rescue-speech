// 实时模式：麦克风 → PCM → /ws/asr → 火山流式识别
import { openAsrSocket, type AsrSocket } from "./asr-socket";
import { startPcmCapture, type PcmCapture } from "./pcm-capture";
import type { Runner, RunnerContext } from "./runner";

const FINAL_WAIT_MS = 5000;

function describeMicError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "麦克风权限被拒绝：请在浏览器地址栏允许麦克风后重试";
  if (name === "NotFoundError") return "未检测到麦克风设备";
  if (name === "NotReadableError") return "麦克风被其他程序占用或无法读取";
  if (!navigator.mediaDevices?.getUserMedia) return "当前页面无法使用麦克风（需 localhost 或 https）";
  return "无法打开麦克风";
}

export async function startLive(ctx: RunnerContext): Promise<Runner> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error(describeMicError(null));

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    throw new Error(describeMicError(e));
  }
  const releaseMic = () => stream.getTracks().forEach((t) => t.stop());

  let socket: AsrSocket | undefined;
  let capture: PcmCapture | undefined;
  try {
    socket = await openAsrSocket({ onSegment: ctx.emit, onFailure: ctx.fail });
    capture = await startPcmCapture(stream, (pcm) => socket!.send(pcm));
  } catch (e) {
    socket?.close();
    releaseMic();
    throw e;
  }

  for (const track of stream.getAudioTracks()) {
    track.onended = () => ctx.fail("麦克风已断开");
  }

  let stopping: Promise<boolean> | null = null;
  return {
    notice: "实时模式：麦克风转写中",
    stop() {
      stopping ??= (async () => {
        for (const track of stream.getAudioTracks()) track.onended = null;
        await capture!.stop();
        releaseMic();
        const complete = await socket!.end(FINAL_WAIT_MS);
        socket!.close();
        return complete;
      })();
      return stopping;
    },
  };
}
