// 浏览器音频 → 16kHz / 16bit / 单声道 PCM，每块 200ms（3200 个采样点 = 6400 字节）。
// 重采样在 AudioWorklet 中完成（按比例区间求平均，兼作简单低通），不依赖浏览器支持 16k AudioContext。

const WORKLET_SOURCE = `
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0; this.acc = 0; this.cnt = 0;
    this.out = new Int16Array(3200); this.n = 0;
    this.port.onmessage = (e) => { if (e.data === "flush") this.flush(); };
  }
  emit() {
    const v = Math.max(-1, Math.min(1, this.acc / this.cnt));
    this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    this.acc = 0; this.cnt = 0;
    if (this.n === this.out.length) this.flush();
  }
  flush() {
    if (this.n > 0) {
      const chunk = this.out.slice(0, this.n);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this.n = 0;
    }
    this.port.postMessage("flushed");
  }
  process(inputs) {
    const chs = inputs[0];
    if (!chs || chs.length === 0) return true;
    const len = chs[0].length;
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let c = 0; c < chs.length; c++) s += chs[c][i];
      this.acc += s / chs.length; this.cnt++;
      this.pos += 1;
      if (this.pos >= this.ratio) { this.pos -= this.ratio; this.emit(); }
    }
    return true;
  }
}
registerProcessor("pcm-downsampler", PcmDownsampler);
`;

export interface PcmCapture {
  /** 送出缓冲中不足 200ms 的尾巴，然后断开音频图。 */
  stop(): Promise<void>;
}

export async function startPcmCapture(
  stream: MediaStream,
  onChunk: (pcm: ArrayBuffer) => void,
): Promise<PcmCapture> {
  const ctx = new AudioContext();
  try {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-downsampler", { numberOfOutputs: 1 });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);

    let onFlushed: (() => void) | null = null;
    node.port.onmessage = (e) => {
      if (e.data === "flushed") onFlushed?.();
      else onChunk(e.data as ArrayBuffer);
    };

    return {
      async stop() {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 500);
          onFlushed = () => {
            clearTimeout(timer);
            resolve();
          };
          node.port.postMessage("flush");
        });
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        await ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    await ctx.close().catch(() => {});
    throw e;
  }
}
