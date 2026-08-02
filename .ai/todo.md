# Slice 5 — derush: the review pass

## Slice 4 close-out (DONE 2026-08-02)

- [x] StudioView double-publish guard + take preview — already committed as `3f8b9e5`; both
      mirrors (Gitea + GitHub) carry it, live bundle matches the local build hash.
- [x] `pnpm fmt:check` was red on `docs/handover/favicon-ripples.md` (committed unformatted by
      the favicon-lab work) — fixed in `9adcae8`.
- [ ] **Runtime acceptance — still blocked.** The Claude browser extension is not connected, so
      no browser path has been exercised: live mic, OPFS, MediaRecorder MIME, WebCodecs Opus,
      the −16 ±1 LUFS / −1 dBFS measurement over a published blob, the `.pub.md` round trip,
      and the iOS Safari gate. Everything below is code-complete against the same gap.

## Slice 5 (DONE, runtime-pending)

- [x] Peaks pass — `peaks.ts` (compute, encode/decode with a version header, column reduce),
      `opfsPeaks.ts`, `take.peaksPath` filled on stop.
- [x] `speechOnsets` in `pauses.ts`, off the same envelope as the silences.
- [x] `analyzeTake.ts` — one decode per take feeds peaks, cuts, onsets, LUFS, and keeps the
      samples so publish does not decode again.
- [x] `derush.ts` — reject region, ripple relayout, apply pause cuts, retake regions, mute /
      solo, shuttle ladder, flag jumps, kept-playback skip. All pure, all specced.
- [x] `history.ts` — undo as a list of past EDLs. No redo.
- [x] `TakeWaveform.vue` — peaks + kept/removed + flags + cut candidates + onsets + in/out +
      playhead. Click to seek, drag to select.
- [x] `DerushPanel.vue` — take list (duration / kept / flags / LUFS), transport, keyboard
      (space, J K L, I O, X, `[` `]`, ctrl-Z), remove pauses, cut flagged retakes.
- [x] Flags → cuts: a `retake` mark becomes a rejectable region back to the speech onset.
- [x] Flag decision: **two buttons, two keys** (`F` mark, `R` retake). Double-tap dropped —
      see the handover for why.
- [x] `publishSession.ts` renders the whole EDL; `publishTake.ts` removed. Pause removal is no
      longer a publish-time boolean.
- [x] StudioView is session-driven: multi-take, undo stack, derush panel, publish, reset.
- [x] Gates: build clean (zero warnings, font `@import` line 1), lint, fmt:check, 186 tests.
- [x] README macroplan: Derush delivered + learning. `docs/handover/slice-5-derush.md`.

## After slice 5 (DONE, still runtime-pending)

- [x] `d8afd4d` picked-note feedback, hourly service-worker update poll, PWA dev options.
- [x] `414b17f` wedged `isRecording` flag no longer hides the update toast; specs for
      `NewVersion` and `useTakeRecorder`; `src/test/pwaRegisterStub.ts`.
- [x] `6e965ba` dropped the `z-index: 1` floor on `.nav` / `main` / `.footer` in `App.vue` —
      that was why the body-teleported toast was invisible.
- [x] Gates at `3673269`: build clean, lint, fmt:check, **194 tests**. Live bundle
      `index-BletfXiY.js` matches the local build — deployed and verified.

## Slice 6 — cue track (delivered, code-complete, live-pending)

- [x] Procedural bed engine `beds.ts` — seeded pure function, windowed-equality asserted.
- [x] Imported files (`cueImport.ts` verbatim MIME, `opfsCues.ts`), `{kind:"file"}` cues.
- [x] Two-stage mix: chain over speech only, cues summed after, final limiter (`assemble.ts`).
- [x] Per-cue duck (offline speech envelope, 300/800 ms) and equal-power fades (`duck.ts`).
- [x] Snap index over clip boundaries / flags / onsets / chapters (`snap.ts`).
- [x] Room-tone fill; chapters (drop on `C`, list); bitrate content tier surfaced.
- [x] `CueTrackPanel.vue` + mounted spec; **257 tests**, build clean, CSS 69.89 kB no leak.
- [ ] **Live-verify (browser gate):** beds heard, mix under real speech, file import + OPFS
      quota, iOS Safari, the −16/−1 measurement over a published blob, `.pub.md` round trip.

## Slice 7 — music slots, replacing the cue track (delivered, code-complete, live-pending)

Design: `docs/superpowers/specs/2026-08-02-music-slots-design.md`.
Handover: `docs/handover/slice-7-music-slots.md`.

- [x] `Session.musicSlots` — intro / break / outro, each with an anchor, a length, gain, duck
      and a picked track (`edl.types.ts`).
- [x] The cue track is now derived, not stored: `cueClipsFromSlots` projects it on every read
      (`musicSlots.ts`). Looping is a projection concern — repeated clips, 0.5 s crossfades.
- [x] Openverse client, no API key (anon limit is per client IP): CC0/CC-BY over Freesound and
      Wikimedia. Jamendo excluded — its CDN pins ACAO to another origin (`openverse.ts`).
- [x] `credits` on `space.remanso.recording`, CC-BY only, plus credit lines under the markdown
      link (`publishSession.ts`, `uploadRecording.ts`, lexicon).
- [x] `MusicSlotPanel.vue` + mounted spec; `speechDurationSec` / `programmeDurationSec` split so
      `musicSlots` imports `edl` and never the reverse.
- [x] Deleted `beds.ts`, `cueImport.ts`, `CueTrackPanel.vue` and the cue-clip EDL ops.
- [x] Gates: **284 tests**, build clean, typecheck, lint, fmt.
- [ ] **Live-verify (browser gate):** search, preview, pick, render with music under real speech,
      publish and read `credits` back off the PDS, OPFS quota with a fetched track, iOS Safari.

## Lexicon resolution (DONE 2026-08-02)

- [x] `_lexicon.remanso.space` TXT = `did=did:plc:4m3kouplb7s7xozjd3whinvl`, written as an
      `at.marque.dns` entry on the `remanso.space` zone (marque NS serves it directly).
- [x] Republished `com.atproto.lexicon.schema/space.remanso.recording` — the live copy predated
      slice 7 and had neither `credits` nor the `#credit` def. `space.remanso.note` republished
      after fixing the `descriptions` → `description` typo in the `#image` def.
- [x] Verified the whole chain: NSID → authority → TXT → PLC → PDS → `getRecord`.

## Carried forward (slice 8+)

- [x] Move the render to a Worker. `renderSessionInWorker` runs the pure `renderSession` in
      `renderWorker.ts` (module Worker, 7 kB chunk), copies PCM in, transfers samples out;
      synchronous fallback for jsdom / no-module-Worker. Only publish call site changed. 286 tests.
- [ ] Recover-session reconcile-on-open banner (`listTakePaths`/`listCuePaths` + `checkQuota`).
- [ ] EDL persistence in IndexedDB behind a comlink Worker.
- [ ] Trim inside a slot: `MusicSlot.inSec` exists and only the fill path writes it.
- [ ] Search pagination — `searchMusic` takes a page and the panel never asks for a second one.
- [ ] `/listen` should render a recording's `credits`; the field is written and nothing reads it.
- [ ] Delete a slot's OPFS track when no other slot plays it (orphans survive today).
