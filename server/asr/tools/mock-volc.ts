// 离线模拟火山流式 ASR（同一套二进制协议），用于没有密钥或断网时联调 /ws/asr。
// 不做真实识别：每收到 3 秒音频返回一句“模拟识别”，并附带该段音量，便于确认音频真实到达。
//
// 用法：npx tsx server/asr/tools/mock-volc.ts   （监听 ws://localhost:3101）
// 然后在 .env 中设置：ASR_WS_URL=ws://localhost:3101  ASR_API_KEY=任意值
import { gunzipSync, gzipSync } from "node:zlib";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.MOCK_ASR_PORT ?? 3101);
const BYTES_PER_MS = 32;
const SENTENCE_MS = 3000;

function response(payload: object, last: boolean, seq: number): Buffer {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  const head = Buffer.from([0x11, (0b1001 << 4) | (last ? 0b0011 : 0b0001), 0x11, 0]);
  const meta = Buffer.alloc(8);
  meta.writeInt32BE(last ? -seq : seq, 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, meta, body]);
}

const wss = new WebSocketServer({
  port: PORT,
  verifyClient: ({ req }, cb) => {
    const ok = req.headers["x-api-key"] || (req.headers["x-api-app-key"] && req.headers["x-api-access-key"]);
    if (!ok || !req.headers["x-api-resource-id"]) cb(false, 401, "missing auth headers");
    else cb(true);
  },
});

wss.on("connection", (ws) => {
  let seq = 0;
  let receivedMs = 0;
  let sumSq = 0;
  let samples = 0;
  const utterances: { text: string; start_time: number; end_time: number; definite: boolean }[] = [];
  const closeSentence = (endMs: number) => {
    const start = utterances.length ? utterances[utterances.length - 1].end_time : 0;
    if (endMs <= start) return;
    const rms = samples ? Math.sqrt(sumSq / samples) : 0;
    const db = rms > 0 ? (20 * Math.log10(rms)).toFixed(0) : "-inf";
    utterances.push({ text: `模拟识别第${utterances.length + 1}句，音量${db}dBFS。`, start_time: start, end_time: endMs, definite: true });
    sumSq = 0;
    samples = 0;
  };

  ws.on("message", (data: Buffer) => {
    const type = data[1] >> 4;
    const flags = data[1] & 0x0f;
    const size = data.readUInt32BE(4);
    const body = gunzipSync(data.subarray(8, 8 + size));
    if (type === 0b0001) {
      const req = JSON.parse(body.toString());
      console.log("[mock] full client request", JSON.stringify(req.audio));
      ws.send(response({ result: { text: "", utterances: [] } }, false, ++seq));
      return;
    }
    if (type !== 0b0010) return;
    for (let i = 0; i + 1 < body.length; i += 2) {
      const v = body.readInt16LE(i) / 0x8000;
      sumSq += v * v;
      samples++;
    }
    receivedMs += body.length / BYTES_PER_MS;
    const last = (flags & 0b0010) !== 0;
    const lastEnd = utterances.length ? utterances[utterances.length - 1].end_time : 0;
    if (receivedMs - lastEnd >= SENTENCE_MS || last) closeSentence(Math.round(receivedMs));
    const partial = { text: "（识别中）", start_time: Math.round(receivedMs), end_time: Math.round(receivedMs), definite: false };
    const list = last ? utterances : [...utterances, partial];
    ws.send(response({ result: { text: list.map((u) => u.text).join(""), utterances: list } }, last, ++seq));
    if (last) console.log(`[mock] 收到结束包，共 ${(receivedMs / 1000).toFixed(1)} 秒音频`);
  });
});

console.log(`[mock] 模拟火山 ASR 已监听 ws://localhost:${PORT}`);
