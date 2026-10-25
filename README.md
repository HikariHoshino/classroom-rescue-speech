# Classroom Rescue Speech

Speech module for a classroom transcript application. This repository contains
the deliverable module, its regression tests, and a sample recording, not the
complete classroom rescue application or the inaccessible Gitee repository.

## Contents

- `src/speech/`: microphone capture, 16 kHz PCM, WebSocket client, session lifecycle,
  and audio/text demo playback.
- `server/asr/`: ASR WebSocket route, Volcengine adapter, segment normalization,
  local mock server, and recording transcription CLI.
- `public/demo/lecture.wav`: approximately 104 seconds of placeholder TTS audio.
- `src/speech/session.test.ts` and `server/asr/asr.test.ts`: nine regression and
  local integration tests.

Public application files and the temporary development harness are intentionally
excluded, as required by the original module handoff. There is no standalone
`npm run dev` entry point in this module-only repository.

## Integration

Copy the three module directories into the agreed React/TypeScript/Vite and
Node/Express application. The application must provide `shared/types.ts` with
`InputMode`, `Segment`, `SpeechEvent`, and `SpeechStatus` as specified in the
team contract. Keep the relative directory structure.

The browser entry points are `startSpeech(options)` and `stopSpeech()` from
`src/speech/index.ts`. Store confirmed segments in the application's single
transcript state, replacing records with the same ID.

Register `registerAsrRoutes(httpServer)` from `server/asr/index.ts` once on the
application's HTTP server. Provide runtime dependency `ws`, development
dependencies `@types/ws` and `tsx`, and proxy `/ws` to the backend with `ws: true`.
The integrating application owns its dependency and lock files.

Load backend environment variables before accepting connections:

```dotenv
ASR_APP_ID=
ASR_API_KEY=
ASR_RESOURCE_ID=volc.bigasr.sauc.duration
ASR_WS_URL=
```

For the legacy console, set APP ID and access token. For the API-key console,
leave APP ID empty and set the API key. Empty `ASR_WS_URL` uses the real service;
the local mock uses `ws://localhost:3101`. Never expose these values through
`VITE_` variables or commit a real `.env`.

After integration into the application harness, verify from its root:

```sh
npm run check
npm run build
node --import tsx --test src/speech/session.test.ts server/asr/asr.test.ts
```

The transcription CLI runs from that same root:

```sh
npx tsx server/asr/tools/transcribe-file.ts public/demo/lecture.wav
```

Use `--write` only after backing up the current demo timeline and confirming the
ASR endpoint and recording. Mock output is not a substitute for a real timeline.
The CLI waits at most five seconds for a final result after sending the terminal
audio packet; use `--final-timeout <ms>` to change that wait. A timeout exits with
an error and does not overwrite the existing timeline.

## Verification And Remaining Acceptance

Local verification uses Node v22.18.0. The nine tests cover confirmed/corrected
segments, terminal results, authentication configuration and headers, PCM frames,
WebSocket shutdown, the actual WAV through a mock ASR, and concurrent starts with
old-session cleanup. The session regression fails on the original logic and passes
after the one-line `if (current)` to `while (current)` fix.
The final-result timeout regression also fails on the original CLI and passes
after the bounded-wait fix. Nine additional checks passed in the installed Chrome
browser, including actual AudioWorklet processing with a synthetic microphone.
See [VERIFICATION.md](VERIFICATION.md) for results and remaining acceptance.

These tests do not establish real Volcengine recognition accuracy. Real ASR
credentials, a physical-microphone browser test, the team's final recording,
and integration into the complete team application remain outstanding.
