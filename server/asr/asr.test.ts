import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import WebSocket, { WebSocketServer } from "ws";
import { registerAsrRoutes } from "./index";
import { SegmentCollector } from "./segments";
import { decodeServerFrame, encodeAudio, encodeFullRequest, readAsrConfig, VolcAsrStream } from "./volc";

function response(payload: object, last: boolean): Buffer {
  const body = gzipSync(Buffer.from(JSON.stringify(payload)));
  const meta = Buffer.alloc(8);
  meta.writeInt32BE(last ? -1 : 1, 0);
  meta.writeUInt32BE(body.length, 4);
  return Buffer.concat([Buffer.from([0x11, last ? 0x93 : 0x91, 0x11, 0]), meta, body]);
}

test("only confirmed changes enter the transcript, with stable IDs for corrections", () => {
  const collector = new SegmentCollector();
  const initial = { text: " first ", start_time: 0, end_time: 1000, definite: false };
  assert.deepEqual(collector.update([initial], false), []);
  const confirmed = { ...initial, definite: true };
  assert.deepEqual(collector.update([confirmed], false), [
    { id: "seg-0", startMs: 0, endMs: 1000, text: "first" },
  ]);
  assert.deepEqual(collector.update([confirmed], false), []);
  assert.deepEqual(collector.update([{ ...confirmed, text: "corrected", end_time: 1200 }], false), [
    { id: "seg-0", startMs: 0, endMs: 1200, text: "corrected" },
  ]);
});

test("the final packet preserves the last sentence without re-emitting earlier sentences", () => {
  const collector = new SegmentCollector();
  const first = { text: "first", start_time: 0, end_time: 1000, definite: true };
  collector.update([first], false);
  assert.deepEqual(collector.update([
    first,
    { text: "tail", start_time: 1000, end_time: 1100, definite: false },
    { text: " ", start_time: 1100, end_time: 1200 },
  ], true), [{ id: "seg-1000", startMs: 1000, endMs: 1100, text: "tail" }]);
});

test("ASR configuration selects exactly one authentication scheme", () => {
  assert.equal(readAsrConfig({}), null);
  const modern = readAsrConfig({ ASR_API_KEY: " local-test " })!;
  assert.equal(modern.apiKey, "local-test");
  assert.equal(modern.appKey, undefined);
  assert.equal(modern.url, "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async");
  const legacy = readAsrConfig({ ASR_APP_ID: " app ", ASR_API_KEY: " token " })!;
  assert.equal(legacy.appKey, "app");
  assert.equal(legacy.accessKey, "token");
  assert.equal(legacy.apiKey, undefined);
});

test("audio frames retain PCM bytes and distinguish the terminal packet", () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128]);
  for (const last of [false, true]) {
    const encoded = encodeAudio(pcm, last);
    assert.equal(encoded[1], last ? 0x22 : 0x20);
    assert.equal(encoded.readUInt32BE(4), encoded.length - 8);
    assert.deepEqual(gunzipSync(encoded.subarray(8)), pcm);
  }
  const request = encodeFullRequest({ audio: { rate: 16000 } });
  assert.equal(request[1], 0x10);
  assert.deepEqual(JSON.parse(gunzipSync(request.subarray(8)).toString()), { audio: { rate: 16000 } });
  const payload = { result: { utterances: [] } };
  assert.deepEqual(decodeServerFrame(response(payload, true)), { kind: "result", last: true, payload });
});

test("both authentication schemes send the configured audio format and receive final results", { timeout: 10000 }, async () => {
  const mock = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(mock, "listening");
  const url = `ws://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  const headers: Record<string, string | string[] | undefined>[] = [];
  const requests: any[] = [];
  mock.on("connection", (ws, req) => {
    headers.push(req.headers);
    ws.on("message", (data: Buffer) => {
      if (data[1] >> 4 === 1) requests.push(JSON.parse(gunzipSync(data.subarray(8)).toString()));
      else if (data[1] & 2) ws.send(response({ result: { utterances: [] } }, true));
    });
  });
  try {
    for (const auth of [{ apiKey: "modern-test" }, { appKey: "app-test", accessKey: "legacy-test" }]) {
      let stream!: VolcAsrStream;
      const final = new Promise<void>((resolve, reject) => {
        stream = new VolcAsrStream({ url, resourceId: "resource-test", ...auth }, {
          onResult: (_items, last) => { if (last) resolve(); },
          onError: (_code, message) => reject(new Error(message)),
          onClose: () => reject(new Error("closed before final result")),
        });
      });
      try {
        await stream.connect();
        stream.sendAudio(Buffer.alloc(6400));
        stream.finish();
        await final;
      } finally {
        stream.close();
      }
    }
    assert.equal(headers[0]["x-api-key"], "modern-test");
    assert.equal(headers[0]["x-api-app-key"], undefined);
    assert.equal(headers[1]["x-api-key"], undefined);
    assert.equal(headers[1]["x-api-app-key"], "app-test");
    assert.equal(headers[1]["x-api-access-key"], "legacy-test");
    for (const request of requests) {
      assert.deepEqual(request.audio, { format: "pcm", codec: "raw", rate: 16000, bits: 16, channel: 1 });
      assert.equal(request.request.enable_nonstream, true);
    }
    assert.equal(requests.length, 2);
  } finally {
    for (const ws of mock.clients) ws.terminate();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
});

test("the WebSocket route forwards tail audio before sending the final segment and done", { timeout: 10000 }, async () => {
  const originalEnv = { ...process.env };
  const mock = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(mock, "listening");
  process.env.ASR_WS_URL = `ws://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  process.env.ASR_API_KEY = "local-test";
  const audio: Buffer[] = [];
  mock.on("connection", (ws) => ws.on("message", (data: Buffer) => {
    if (data[1] >> 4 !== 2) return;
    audio.push(gunzipSync(data.subarray(8)));
    if (data[1] & 2) {
      ws.send(response({ result: { utterances: [
        { text: "tail", start_time: 0, end_time: 200, definite: false },
      ] } }, true));
    }
  }));
  const server = createServer();
  registerAsrRoutes(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws/asr`);
  const received: any[] = [];
  const pcm = Buffer.alloc(6400, 1);
  try {
    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("message", (data) => {
        const message = JSON.parse(data.toString());
        received.push(message);
        if (message.type === "ready") {
          client.send(pcm);
          client.send(JSON.stringify({ type: "end" }));
        }
        if (message.type === "done") resolve();
        if (message.type === "error") reject(new Error(message.message));
      });
      client.on("close", () => {
        if (received.at(-1)?.type !== "done") reject(new Error("closed without final result"));
      });
    });
    assert.deepEqual(received, [
      { type: "ready" },
      { type: "segment", segment: { id: "seg-0", startMs: 0, endMs: 200, text: "tail" } },
      { type: "done" },
    ]);
    assert.deepEqual(audio, [pcm, Buffer.alloc(0)]);
  } finally {
    client.terminate();
    for (const ws of mock.clients) ws.terminate();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  }
});

test("the transcription CLI reads the supplied WAV and waits for its terminal result", { timeout: 15000 }, async () => {
  const mock = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await once(mock, "listening");
  let bytes = 0;
  let sawEnd = false;
  mock.on("connection", (ws) => ws.on("message", (data: Buffer) => {
    if (data[1] >> 4 !== 2) return;
    bytes += gunzipSync(data.subarray(8)).length;
    if (data[1] & 2) {
      sawEnd = true;
      ws.send(response({ result: { utterances: [
        { text: "local mock transcript", start_time: 0, end_time: bytes / 32, definite: true },
      ] } }, true));
    }
  }));
  const child = spawn(process.execPath, [
    "--import", "tsx", "server/asr/tools/transcribe-file.ts", "public/demo/lecture.wav", "--interval", "0",
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ASR_API_KEY: "local-test", ASR_WS_URL: `ws://127.0.0.1:${(mock.address() as AddressInfo).port}` },
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", (data) => { stdout += data; });
  child.stderr!.on("data", (data) => { stderr += data; });
  const watchdog = setTimeout(() => child.kill(), 12000);
  try {
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr);
    assert.ok(bytes > 100 * 32000, "the actual demo WAV must reach the mock, not just an empty end frame");
    assert.equal(sawEnd, true);
    assert.match(stdout, /local mock transcript/);
    assert.match(stdout, /1 个片段/);
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) child.kill();
    for (const ws of mock.clients) ws.terminate();
    await new Promise<void>((resolve) => mock.close(() => resolve()));
  }
});
