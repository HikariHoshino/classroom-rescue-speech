// 回放 B：把录好的音频走一遍真实流式识别，用于验证 ASR，并可生成演示时间轴 demo-data.ts。
//
// 用法（项目根目录）：
//   npx tsx server/asr/tools/transcribe-file.ts public/demo/lecture.wav
//   npx tsx server/asr/tools/transcribe-file.ts public/demo/lecture.mp3 --write --url /demo/lecture.mp3
// 选项：
//   --write          生成 src/speech/demo-data.ts（覆盖）
//   --url <路径>     写入 demo-data.ts 的音频地址，默认按 public/ 下的相对路径推断
//   --interval <ms>  每 200ms 音频包的发送间隔，默认 100（2 倍速）；200 为实时
//   --final-timeout <ms>  结束包发出后等待最终结果的时长，默认 5000
// wav 直接读取；其他格式需要本机有 ffmpeg。
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Segment } from "../../../shared/types";
import { SegmentCollector } from "../segments";
import { VolcAsrStream, describeAsrError, describeConnectError, readAsrConfig } from "../volc";

const CHUNK_BYTES = 6400; // 200ms @ 16kHz/16bit/mono

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** 解析 PCM wav（16/24/32bit 整数或 32bit 浮点），转为 16kHz 单声道 s16le。 */
function wavToPcm16k(buf: Buffer): Buffer {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("不是有效的 wav 文件");
  let off = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + size);
    if (id === "fmt ") {
      fmt = { format: body.readUInt16LE(0), channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
      if (fmt.format === 0xfffe) fmt.format = body.readUInt16LE(24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") data = body;
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("wav 缺少 fmt 或 data 段");
  const { format, channels, rate, bits } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(data.length / (bytes * channels));
  const read = (i: number): number => {
    const p = i * bytes;
    if (format === 3 && bits === 32) return data!.readFloatLE(p);
    if (format !== 1) throw new Error(`不支持的 wav 编码 ${format}`);
    if (bits === 16) return data!.readInt16LE(p) / 0x8000;
    if (bits === 24) return data!.readIntLE(p, 3) / 0x800000;
    if (bits === 32) return data!.readInt32LE(p) / 0x80000000;
    throw new Error(`不支持的位深 ${bits}`);
  };
  const mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(f * channels + c);
    mono[f] = s / channels;
  }
  const ratio = rate / 16000;
  const outLen = Math.floor(frames / ratio);
  const out = Buffer.alloc(outLen * 2);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b && k < frames; k++) s += mono[k];
    const v = Math.max(-1, Math.min(1, s / (b - a)));
    out.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  return out;
}

function loadPcm(file: string): Buffer {
  if (file.toLowerCase().endsWith(".wav")) return wavToPcm16k(readFileSync(file));
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], {
    maxBuffer: 1 << 30,
  });
  if (r.error || r.status !== 0)
    throw new Error("非 wav 文件需要 ffmpeg 转码；请安装 ffmpeg，或先把音频转成 wav");
  return r.stdout;
}

function transcribe(pcm: Buffer, intervalMs: number, finalTimeoutMs: number): Promise<Segment[]> {
  const config = readAsrConfig();
  if (!config) throw new Error(".env 中缺少 ASR_API_KEY");
  const collector = new SegmentCollector();
  const result = new Map<string, Segment>();

  return new Promise((resolve, reject) => {
    let finished = false;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(finalTimer);
      stream.close();
      reject(error);
    };
    const stream = new VolcAsrStream(config, {
      onResult(utterances, last) {
        if (finished) return;
        for (const seg of collector.update(utterances, last)) {
          result.set(seg.id, seg);
          console.log(`[${(seg.startMs / 1000).toFixed(1)}s-${(seg.endMs / 1000).toFixed(1)}s] ${seg.text}`);
        }
        if (last) {
          finished = true;
          clearTimeout(finalTimer);
          stream.close();
          resolve([...result.values()].sort((a, b) => a.startMs - b.startMs));
        }
      },
      onError(code, detail) {
        fail(new Error(`${describeAsrError(code)}：${detail}`));
      },
      onClose() {
        fail(new Error("识别服务连接中断"));
      },
    });

    stream.connect().then(
      async () => {
        console.log(`已连接，logid=${stream.logId}，音频 ${(pcm.length / 32000).toFixed(1)} 秒`);
        for (let off = 0; off < pcm.length; off += CHUNK_BYTES) {
          if (finished) return;
          stream.sendAudio(pcm.subarray(off, off + CHUNK_BYTES));
          await new Promise((r) => setTimeout(r, intervalMs));
        }
        if (finished) return;
        finalTimer = setTimeout(() => fail(new Error("等待最终识别结果超时，未生成演示时间轴")), finalTimeoutMs);
        stream.finish();
      },
      (err) => fail(new Error(`${describeConnectError(err)}（${err.message}）`)),
    ).catch(fail);
  });
}

function renderDemoData(segments: Segment[], audioUrl: string, source: string): string {
  const items = segments
    .map((s, i) => {
      const id = `demo-${String(i + 1).padStart(2, "0")}`;
      return `  { id: ${JSON.stringify(id)}, startMs: ${s.startMs}, endMs: ${s.endMs}, text: ${JSON.stringify(s.text)} },`;
    })
    .join("\n");
  return `// 演示回放时间轴（由 server/asr/tools/transcribe-file.ts 生成，可手工微调文字与时间）。
// 来源：${source}
import type { Segment } from "../../shared/types";

/** public/ 下的演示音频地址 */
export const demoAudioUrl = ${JSON.stringify(audioUrl)};

export const demoSegments: Segment[] = [
${items}
];
`;
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.log("用法：npx tsx server/asr/tools/transcribe-file.ts <音频文件> [--write] [--url /demo/xxx] [--interval 100] [--final-timeout 5000]");
    process.exit(1);
  }
  try {
    process.loadEnvFile();
  } catch {
    /* 没有 .env 时使用已有环境变量 */
  }

  const intervalMs = Number(arg("--interval") ?? 100);
  const finalTimeoutMs = Number(arg("--final-timeout") ?? 5000);
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("--interval 必须为非负毫秒数");
  if (!Number.isFinite(finalTimeoutMs) || finalTimeoutMs <= 0) throw new Error("--final-timeout 必须为正毫秒数");
  const pcm = loadPcm(file);
  const segments = await transcribe(pcm, intervalMs, finalTimeoutMs);
  console.log(`\n识别完成：${segments.length} 个片段`);

  if (process.argv.includes("--write")) {
    const rel = path.relative("public", file).split(path.sep).join("/");
    const audioUrl = arg("--url") ?? (rel.startsWith("..") ? "/demo/lecture.mp3" : `/${rel}`);
    const out = path.join("src", "speech", "demo-data.ts");
    writeFileSync(out, renderDemoData(segments, audioUrl, `火山流式识别 ${path.basename(file)}`), "utf8");
    console.log(`已写入 ${out}（音频地址 ${audioUrl}）`);
  }
}

main().catch((e) => {
  console.error(`失败：${e.message}`);
  process.exit(1);
});
