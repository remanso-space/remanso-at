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

## Carried forward (slice 7+)

- [ ] Move the render to a Worker (still synchronous).
- [ ] Recover-session reconcile-on-open banner (`listTakePaths`/`listCuePaths` + `checkQuota`).
- [ ] EDL persistence in IndexedDB behind a comlink Worker.
- [ ] Bare split (no reject) for cue insertion points; move a placed cue without remove-replace.
- [ ] Per-clip best-of-N and a per-cue gain slider in the UI (`setClipMuted`/`setCueClipGainDb`
      exist and are tested).
