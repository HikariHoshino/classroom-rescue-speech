# Verification Record

Date: 2026-10-25. Environment: Windows, Node v22.18.0, installed Google Chrome.

## Automated Tests

The existing local React/Vite/Express harness was used without changing its
public application files. Type checking and the Vite production build passed.
All nine Node tests passed; none were skipped.

```sh
npm run check
npm run build
node --import tsx --test src/speech/session.test.ts server/asr/asr.test.ts
```

The test harness is intentionally not committed to this module-only repository.
These commands run in the integrating application, with the dependencies and
public types described in README.md.

The CLI timeout regression was first run against the original implementation.
It failed because the process remained connected after the terminal audio
packet and needed an external watchdog to kill it. With the fix, the same
scenario exits with code 1 and an explicit timeout error. Even with `--write`,
the existing demo timeline remains byte-for-byte unchanged.

## Browser Acceptance

All nine checks below passed in installed Chrome running headless. Tests used
isolated local frontend, backend, and mock-ASR ports. Audio capture came from
Chrome's synthetic microphone, not a physical microphone. The ASR was a local
binary-protocol mock, not Volcengine.

| Check | Result |
| --- | --- |
| Actual WAV playback emits timestamped demo transcript | Pass |
| Repeated start retains one playback; repeated stop releases it | Pass |
| Natural playback completion emits all 12 timeline segments | Pass |
| Missing audio falls back to explicitly labelled text playback | Pass |
| Synthetic microphone passes through AudioWorklet and backend to final transcript | Pass |
| Upstream disconnect reports error and ends microphone tracks | Pass |
| Missing final ASR result stops with an incomplete-transcript warning | Pass |
| 390px viewport has no horizontal overflow | Pass |
| No uncaught application errors | Pass |

The AudioWorklet test delivered 96,316 PCM bytes. Normal packets were 6,400 bytes
(200 ms of 16 kHz, 16-bit mono audio); a terminal packet arrived and all browser
capture tracks ended after stop. The browser's missing-final-result case stopped
in approximately 5.1 seconds.

## Remaining Acceptance

- Real Volcengine recognition requires valid backend credentials and an enabled
  ASR resource. No real recognition success is claimed.
- A person must start capture and grant permission in a normal browser to verify
  the physical microphone. Synthetic input does not complete this check.
- The final team recording has not been supplied; the committed WAV is still the
  original TTS placeholder. Its timeline has not been overwritten.
- The complete team application has not been supplied. This module has not been
  adapted to or merged into an unavailable main application.

Do not describe this module as fully accepted real-time classroom transcription
until the remaining real-service and physical-device checks have passed.
