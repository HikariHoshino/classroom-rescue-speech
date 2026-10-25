// 演示模式：播放 public/demo/ 下的课堂音频，按播放进度从 demo-data.ts 时间轴释放片段。
// 音频加载失败时改为按计时器回放文本，并在状态提示里标明来源。
import { demoAudioUrl, demoSegments } from "./demo-data";
import type { Runner, RunnerContext } from "./runner";

const LOAD_TIMEOUT_MS = 8000;
const TICK_MS = 200;

function playAudio(audio: HTMLAudioElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
    audio.onerror = () => {
      clearTimeout(timer);
      reject(new Error("load"));
    };
    audio.play().then(
      () => {
        clearTimeout(timer);
        audio.onerror = null;
        resolve();
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function startDemo(ctx: RunnerContext): Promise<Runner> {
  const segments = [...demoSegments].sort((a, b) => a.startMs - b.startMs);
  const lastEndMs = segments.length ? segments[segments.length - 1].endMs : 0;

  let audio: HTMLAudioElement | null = new Audio(demoAudioUrl);
  audio.preload = "auto";
  let notice = "演示模式：播放课堂回放音频，字幕来自预置时间轴";
  try {
    await playAudio(audio);
  } catch {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio = null;
    notice = "演示模式：回放音频加载失败，改为纯文本回放（字幕来自预置时间轴）";
  }

  const t0 = performance.now();
  const nowMs = () => (audio ? audio.currentTime * 1000 : performance.now() - t0);
  let next = 0;
  let stopped = false;

  const release = () => {
    stopped = true;
    clearInterval(timer);
    if (audio) {
      audio.onended = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  };
  const flushUntil = (ms: number) => {
    while (next < segments.length && segments[next].endMs <= ms) ctx.emit(segments[next++]);
  };
  const end = () => {
    if (stopped) return;
    flushUntil(Number.POSITIVE_INFINITY);
    release();
    ctx.finish("演示回放结束");
  };

  const timer = setInterval(() => {
    flushUntil(nowMs());
    if (!audio && nowMs() > lastEndMs) end();
  }, TICK_MS);
  if (audio) audio.onended = end;

  return {
    notice,
    async stop() {
      if (!stopped) release();
      return true;
    },
  };
}
