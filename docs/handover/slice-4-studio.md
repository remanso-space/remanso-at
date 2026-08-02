# Slice 4 — the studio: capture → link

Built 2026-08. Code-complete, all build gates green, **not yet verified against a live
microphone** (see "Verified, not assumed"). Read slice 0/1/2's handovers and the plan doc for
the decisions; this file covers only what slice 4 changed and where slice 5 starts.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`.
Slice 2: `docs/handover/slice-2-signin.md`.

## What shipped

`/studio`, signed in, is now the real studio. The whole loop exists:

1. **Opus gate** — `canEncodeAudio("opus")` runs on mount. No encode → a clear refusal, because
   there is no original to fall back to (the studio's single point of failure).
2. **Your published notes** — `listRecords` over `space.remanso.note` on your PDS; each note is
   marked ♪ (already embeds an `at://…/space.remanso.recording/…`) or — (silent). Picking one
   prefills the episode title.
3. **One take** — mic picker, live level meter, wall-clock elapsed, `Flag ▹` / `Bad take ✕` while
   recording. Chunks stream to OPFS as they arrive (one file per take). A local `<audio>` preview
   of the take appears after Stop.
4. **Review** — a "trim head/tail + remove long pauses" toggle.
5. **Render** — assemble the kept regions → HPF + presence shelf → two-pass normalise to −16 LUFS
   → look-ahead limiter at −1 dBFS → Opus/WebM. Synchronous (not a Worker yet).
6. **Publish** — `uploadBlob` + `createRecord` a `space.remanso.recording`, then show the copyable
   `![<title> - audio](at://…)`. **Never writes a note.** After a successful publish the take is
   spent: the controls become Copy link + Start a new recording (no second publish of the same
   audio), and the take's OPFS bytes are freed.

The `NewVersion` update toast is suppressed while a take is recording.

## New machinery (all under `src/modules/studio/` unless noted)

- **EDL** — `edl.types.ts` (Session/Take/Track/Clip/Chapter/Marker/ChainSettings), `edl.ts`
  (newSession, addTake, trimClip, splitClipAt, timelineDurationSec, projectChapterToTimeline,
  DEFAULT_CHAIN). Multi-track from day one; slice 4 only fills the speech track.
- **Pause detection** — `pauses.ts`: RMS envelope, `detectSilences` (two-threshold hysteresis off
  the measured floor, with a dynamic-range guard that declines rather than cut speech),
  `planCuts` (head/tail full, interior → 350 ms), `keptRegions` (the complement).
- **Render chain** — `renderChain.ts`: RBJ HPF + high shelf (persistent biquad state),
  `renderProgramme` (two-pass loudness), `createLimiter` (sliding-window-max deque, **hard −1 dBFS
  guarantee**). Every stage is seam-free by construction — verified windowed == whole, bit-identical.
- **Assembly** — `assemble.ts`: `assembleSpeech` (clips → timeline PCM: trims, placement, gain,
  equal-power fades, muted exclusion, pause-cut ripple), `renderSession`.
- **Codec** — `mediaCodec.ts`: `canEncodeOpus`, `decodeTakeToMono` (mediabunny AudioBufferSink
  stream → mono at 48 k), `encodeOpus` (AudioBufferSource → WebM/Opus File), `bitrateFor`.
  `pcm.ts`: `downmixToMono`, `resampleLinear`.
- **Storage** — `opfsTakes.ts`: streaming take writer, read-as-File, delete, `listTakePaths`,
  `checkQuota` (estimate + persist).
- **Publish** — `publishTake.ts` orchestrates read → decode → cuts → render → encode → upload →
  link. `atproto/publishedNotes.ts`: `listPublishedNotes`, `noteRecordingUris`, `recordingAltFor`,
  `recordingMarkdownLink`. `atproto/uploadRecording.ts` mirrored from remanso.space.
- **Capture** — `composables/useTakeRecorder.ts` (mic devices, `AudioContext`@48 k, `MediaRecorder`
  @96 kbps, MIME_CANDIDATES, OPFS streaming, flag, `beforeunload`),
  `composables/useRecordingState.ts` (shared flag for toast suppression).

## Verified, not assumed

**Verified:** `pnpm build` clean (zero warnings, font `@import` still line 1), `pnpm lint`,
`pnpm fmt:check` clean, `pnpm test:run` = **125 tests** green. The dev server transforms every new
module with no error. Test coverage includes the properties that matter: windowed-equality of the
chain and limiter (bit-identical), the −1 dBFS ceiling guarantee, normalise-to-−16, the pause
hysteresis + speech guard, EDL edits + chapter projection through trims, clip assembly, and the
list/scan/link path.

**Not yet verified (needs a real browser + mic + an iOS device — the Claude browser extension was
not connected in the session that built this):**

- Live mic capture, OPFS write/read, `MediaRecorder` MIME on the target browser.
- WebCodecs Opus encode actually producing a playable blob.
- The acceptance gate: record 2 min → reload mid-take recovery → render → the published blob
  measures −16 ±1 LUFS and true peak ≤ −1 dBFS (script over `getBlob` + `loudness.ts`).
- Round-trip: paste the link into a `.pub.md`, push, confirm the note republishes with audio.
- iOS Safari (MediaRecorder mime, OPFS/private-mode, AudioContext gesture gating, backgrounding).

## Deltas from the plan (deliberate, for slice 5+ to close)

- **Flags are captured but not consumed.** `Flag ▹`/`Bad take ✕` stamp `{atTakeSec, kind}` onto the
  take; nothing acts on them yet — that is the derush pass (slice 5). Split into two buttons rather
  than the plan's one-button tap/double-tap, and there is no keyboard shortcut yet.
- **Render is synchronous**, not a Worker. Fine for ~20-minute takes; move it if it blocks the UI.
- **Peaks are not computed** (`take.peaksPath` is `""`). The waveform in slice 5 needs them.
- **Recover-session is half-wired.** `listTakePaths` + `checkQuota` exist but there is no
  reconcile-on-open banner yet.
- **Multi-take is out** (one take at a time), as scoped.

## Gotchas

- **vitest/vite type split.** vitest 3 bundles vite 7 types that clash with this app's vite 8, so
  a `test` block on the vite 8 config type-errors under vue-tsc. Test config lives in a standalone
  `vitest.config.ts` kept out of every tsconfig; vitest transpiles it at runtime, so the clash never
  surfaces. Keep `vite.config.ts` free of test config.
- **esbuild** (via vitest) needed an explicit `allowBuilds` decision in `pnpm-workspace.yaml`
  (`false`), same class as slice 0's sharp/core-js, or Docker `--frozen-lockfile` fails.
- **mediabunny** is lazy-imported and narrowed to the containers a MediaRecorder produces plus the
  import formats, mirroring remanso's `normalizeAudioFile.ts`. The renderer builds `AudioBuffer`
  with its standalone constructor (no AudioContext). `copyToChannel` needs an ArrayBuffer-backed
  view, so a `subarray` must be copied into a fresh `Float32Array` first.

## Where slice 5 starts — derush

Slice 5 is the review UI over an EDL that **already renders**. The machinery is in place: `edl.ts`
splits/trims and projects chapters, `pauses.ts` gives cut candidates + speech onsets, `assemble.ts`
renders muted-exclusion and fades, and flags are already captured on every take. What slice 5 adds:

- A **peaks pass** (fill `take.peaksPath`) for the waveform.
- The review view: take list, waveform + flags + pause-cut candidates + speech onsets, keyboard
  shuttle (space / J K L / I O / X reject / `[` `]` jump flags), best-of-N (`muted` clip), and undo
  (snapshot the plain EDL object per op).
- Wire flags → cuts (a `retake` mark becomes a rejectable region).

## Guardrails carried forward

- **Never `putRecord` a note.** The `.pub.md` in git is the source of truth; the studio only
  publishes a recording and hands back a link.
- `canEncodeAudio("opus")` gate at session start — refuse clearly, no fallback.
- Suppress the `NewVersion` toast while recording.
- Font `@import` stays line 1 of `src/style.css`; `#ffa4c0` chrome byte-identical; no `/ambient`;
  do not touch `remanso-jetstream`; sessions are not shared with remanso.space.

## Uncommitted at handoff

`src/views/StudioView.vue` carries the last fix of the session — the double-publish guard and the
local take preview — and is not yet committed. Everything else in this slice is committed
(`6f82e9c`, `0695353`, `0ee7c09`).
