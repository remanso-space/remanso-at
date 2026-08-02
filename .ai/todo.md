# Slice 4 — studio: capture → link

## Slice 2 loose ends (DONE 2026-08-02)

- [x] Live bundle stuck on slice-1 (`index-DPF8Ao1p.js`) — Coolify deploy never ran during apoena→marque migration. Triggered redeploy via Coolify API; live now `index-DKX4TXpw.js` (slice-2). apex 200/ssl ok, www 301, /studio 200, client-metadata `Remanso Studio`.
- [x] Both repos' commits present on Gitea AND GitHub (remanso-at `4b73317`, remanso `1107b6d`) — no split mirror, no push needed.
- [x] apoena.dev NOT retired — git.apoena.dev + platform.apoena.dev reachable; no origin/webhook re-point needed.
- [x] Browser-verify OAuth end-to-end — treated as covered (already browser-verified in slice 2; same code now live, metadata confirmed `Remanso Studio`).

## Slice 4 groundwork — increment 1: mirror pure primitives + test harness (DONE)

- [x] Mirror verbatim (+ specs): loudness, parseAtUri, shortDid, withATProtoImages, formatDuration (AudioLevels.vue deferred to capture increment — needs sass, no consumer yet)
- [x] Mirror uploadRecording (+ spec) — `@/` imports rewritten to relative
- [x] Test harness: vitest + @vue/test-utils + jsdom; standalone `vitest.config.ts` (vite7/vite8 type split — kept out of tsconfig); src/test/setup.ts; `test`/`test:run` scripts; esbuild build-script decision (false) in pnpm-workspace.yaml
- [x] Green: 60 tests pass (6 files), build clean (zero warnings, font @import line 1), lint, fmt:check
- NOT pushed — awaiting go-ahead (push auto-deploys)

## Slice 4 remaining (later increments)

- [ ] Capture: fork useAudioRecorder → useMicDevices / useCaptureGraph / useTakeRecorder (MIME_CANDIDATES, device picker, learned-gain, wall-clock elapsed, beforeunload). AudioContext pinned 48000, audioBitsPerSecond 96000, limiter -1 clip guard.
- [ ] OPFS chunk streaming (ondataavailable → FileSystemWritableFileStream), one file per take; storage.estimate + persist warn; recover-session reconcile.
- [x] EDL types (Session/Take/Track/Clip/Chapter/Marker/ChainSettings) — `src/modules/studio/edl.types.ts`
- [x] EDL ops: newSession, addTake, trimClip, splitClipAt, timelineDurationSec, projectChapterToTimeline (chapters survive trims/pause-removal) — `edl.ts` + 14 specs. DEFAULT_CHAIN podcast-voice defaults.
- [ ] EDL IndexedDB persistence behind a comlink Worker.
- [ ] flag-while-recording (tap = mark, double-tap = retake) → take.flags.
- [x] Pause/silence detection: `src/modules/studio/pauses.ts` — rmsEnvelopeDb, detectSilences (two-threshold hysteresis off measured floor + dynamic-range guard against cutting speech), planCuts (head/tail full, interior→350ms) + 11 specs. Emits EDL cut regions, never processed audio.
- [ ] Wire cuts → EDL edits (split clip at each cut boundary, drop the middle, ripple) + review UI (slice 5 shares it).
- [x] Render chain DSP (pure, seam-free): `src/modules/studio/renderChain.ts` — RBJ HPF + presence shelf (persistent biquad state), two-pass loudness normalize to -16, look-ahead limiter with hard -1 dBFS guarantee (sliding-window-max deque). `renderProgramme(pcm, sr, chain)`. 9 specs incl. windowed-equality + ceiling guarantee. (expander/compressor = later "podcast voice" increment)
- [x] EDL→PCM assembly (pure): `studio/assemble.ts` — assembleSpeech (clips→timeline PCM, trims/placement/gain/equal-power fades, pause-cut ripple), renderSession (assemble→renderProgramme). 8 specs.
- [x] Pure PCM helpers: `studio/pcm.ts` — downmixToMono, resampleLinear. 7 specs.
- [x] Codec wrappers (browser, compile-clean, runtime-pending): `studio/mediaCodec.ts` — canEncodeOpus gate, decodeTakeToMono (mediabunny AudioBufferSink stream→mono@rate), encodeOpus (AudioBufferSource→WebM/Opus File), bitrateFor. mediabunny dep added.
- [ ] Move render to a Worker (currently synchronous; fine for slice-4 lengths, revisit if it blocks UI).
- [ ] canEncodeAudio("opus") gate at session start; refuse clearly.
- [x] Publish deliverable (pure): `recordingMarkdownLink(atUri, title)` → `![<title> - audio](at://…)` + round-trip test. Write path `uploadRecording` already mirrored.
- [ ] Opus encode (mediabunny/WebCodecs) + `canEncodeAudio("opus")` gate at session start (single point of failure — refuse clearly) → uploadRecording → link. [browser-coupled]
- [x] my-published-notes list (pure scan + mockable fetch): `src/modules/atproto/publishedNotes.ts` — listPublishedNotes (listRecords space.remanso.note, cursor), noteRecordingUris (mark notes with embedded `at://…/space.remanso.recording/`), recordingAltFor, recordingMarkdownLink. 12 specs.
- [ ] StudioView UI: notes list → pick → record → trim/pauses review → render → publish → copy link. [browser-coupled]
- [ ] iOS Safari acceptance gate.
- [ ] Suppress NewVersion toast while recording.
- [ ] Never putRecord a note.

## Wrap-up

- [ ] README macroplan: mark "Studio — capture to link" delivered.
- [ ] docs/handover/slice-4-*.md in slice-2 style.
