import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { startSpeech, stopSpeech } from "./index";

test("overlapping starts release every superseded demo and suppress its callbacks", async () => {
  const originals = {
    Audio: Object.getOwnPropertyDescriptor(globalThis, "Audio"),
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const audios: FakeAudio[] = [];
  const ticks = new Map<number, () => void>();
  const events: { sessionId: string; status: string }[] = [];
  const emitted: string[] = [];
  let nextTimer = 0;
  let releaseFirst!: () => void;
  const firstPlay = new Promise<void>((resolve) => { releaseFirst = resolve; });

  class FakeAudio {
    currentTime = 0;
    preload = "";
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = true;
    constructor(_url: string) { audios.push(this); }
    async play() {
      if (audios.length === 1) await firstPlay;
      this.paused = false;
    }
    pause() { this.paused = true; }
    removeAttribute(_name: string) {}
    load() {}
  }

  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  globalThis.setInterval = ((callback: () => void) => {
    const id = ++nextTimer;
    ticks.set(id, callback);
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((id: number) => {
    ticks.delete(id);
  }) as unknown as typeof clearInterval;
  const start = (sessionId: string) => startSpeech({
    sessionId,
    mode: "demo",
    onSegment: (id) => emitted.push(id),
    onStatus: (event) => events.push(event),
  });

  try {
    const first = start("first");
    const second = start("second");
    const third = start("third");
    releaseFirst();
    await Promise.all([first, second, third]);
    await setImmediate();

    assert.equal(audios.length, 3);
    assert.deepEqual(audios.map((audio) => audio.paused), [true, true, false],
      "only the newest class may retain playing audio");
    assert.equal(ticks.size, 1, "superseded classes must not retain playback timers");
    for (const audio of audios) audio.currentTime = 10;
    for (const tick of ticks.values()) tick();
    assert.deepEqual(emitted, ["third"], "an old class must not write into the current transcript");
    assert.equal(events.filter((event) => event.sessionId === "second" && event.status === "stopped").length, 1);

    await Promise.all([stopSpeech(), stopSpeech()]);
    assert.equal(ticks.size, 0);
    assert.ok(audios.every((audio) => audio.paused));
  } finally {
    releaseFirst();
    await stopSpeech();
    ticks.clear();
    if (originals.Audio) Object.defineProperty(globalThis, "Audio", originals.Audio);
    else Reflect.deleteProperty(globalThis, "Audio");
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
  }
});
