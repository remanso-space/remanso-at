# Slice 4 — studio: capture → link

## Slice 2 loose ends (DONE 2026-08-02)

- [x] Live bundle stuck on slice-1 (`index-DPF8Ao1p.js`) — Coolify deploy never ran during apoena→marque migration. Triggered redeploy via Coolify API; live now `index-DKX4TXpw.js` (slice-2). apex 200/ssl ok, www 301, /studio 200, client-metadata `Remanso Studio`.
- [x] Both repos' commits present on Gitea AND GitHub (remanso-at `4b73317`, remanso `1107b6d`) — no split mirror, no push needed.
- [x] apoena.dev NOT retired — git.apoena.dev + platform.apoena.dev reachable; no origin/webhook re-point needed.
- [ ] Browser-verify OAuth end-to-end (needs interactive atproto login) — sign-in was already browser-verified in slice 2; deferred pending live login.

## Slice 4 groundwork — increment 1: mirror pure primitives + test harness (DONE)

- [x] Mirror verbatim (+ specs): loudness, parseAtUri, shortDid, withATProtoImages, formatDuration (AudioLevels.vue deferred to capture increment — needs sass, no consumer yet)
- [x] Mirror uploadRecording (+ spec) — `@/` imports rewritten to relative
- [x] Test harness: vitest + @vue/test-utils + jsdom; standalone `vitest.config.ts` (vite7/vite8 type split — kept out of tsconfig); src/test/setup.ts; `test`/`test:run` scripts; esbuild build-script decision (false) in pnpm-workspace.yaml
- [x] Green: 60 tests pass (6 files), build clean (zero warnings, font @import line 1), lint, fmt:check
- NOT pushed — awaiting go-ahead (push auto-deploys)

## Slice 4 remaining (later increments)

- [ ] Capture: fork useAudioRecorder → useMicDevices / useCaptureGraph / useTakeRecorder (MIME_CANDIDATES, device picker, learned-gain, wall-clock elapsed, beforeunload). AudioContext pinned 48000, audioBitsPerSecond 96000, limiter -1 clip guard.
- [ ] OPFS chunk streaming (ondataavailable → FileSystemWritableFileStream), one file per take; storage.estimate + persist warn; recover-session reconcile.
- [ ] EDL types (Session/Take/Track/Clip/Chapter) + IndexedDB persistence behind a comlink Worker.
- [ ] flag-while-recording (tap = mark, double-tap = retake) → take.flags.
- [ ] Trim head/tail + remove-pauses (RMS envelope + hysteresis → EDL edits, review UI).
- [ ] Windowed multi-track Worker renderer: speech chain (HPF 80 + expander + presence shelf + compressor + makeup) → sum cues → two-pass loudness -16 → look-ahead limiter -1. mediabunny AudioBufferSink + audioBufferSource encode.
- [ ] canEncodeAudio("opus") gate at session start; refuse clearly.
- [ ] Opus encode → uploadRecording → createRecord space.remanso.recording → copyable `![title - audio](at://…)`.
- [ ] my-published-notes list: listRecords space.remanso.note, mark notes with `at://…/space.remanso.recording/` in content, prefill title/alt.
- [ ] iOS Safari acceptance gate.
- [ ] Suppress NewVersion toast while recording.
- [ ] Never putRecord a note.

## Wrap-up

- [ ] README macroplan: mark "Studio — capture to link" delivered.
- [ ] docs/handover/slice-4-*.md in slice-2 style.
