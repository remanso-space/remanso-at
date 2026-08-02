# Slice 5 — derush: the review pass

Built 2026-08. Code-complete, all build gates green, **not yet verified against a live
microphone** — the same gap slice 4 left, for the same reason (no browser extension in the
session that built it). Read slice 4's handover first; this file covers only what slice 5
changed and where slice 6 starts.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`.
Slice 4: `docs/handover/slice-4-studio.md`.

## What shipped

`/studio` is no longer one take at a time. The EDL is the state of the page: record appends
a take, the review pass edits the edit list, and publish renders whatever the list currently
says. Nothing in the publish path has an opinion about the audio any more.

1. **A take is analysed once.** Stop → decode → peaks, pause candidates, speech onsets and a
   raw LUFS reading, all from the same buffer. The samples stay in memory, so publish does
   not decode the take a second time. Peaks go to OPFS and fill `take.peaksPath`.
2. **Take list** — duration, seconds still kept, flag count, measured LUFS. Pick one to
   review; **Mute** or **Solo** it for best-of-N.
3. **Waveform** — the take, drawn from the peaks, with the kept spans in accent and the
   removed ones faint, plus flags (a tick for a mark, a full stem for a retake), pause-cut
   candidates in their own lane, speech onsets, the in/out region and the playhead.
4. **Keyboard shuttle** — space play/pause, `J`/`K`/`L` shuttle (1×, 2×, 4×, and reverse by
   seeking, which is the only reverse a media element offers), `I`/`O` in and out, `X`
   reject, `[`/`]` jump between flags, ctrl/⌘ `Z` undo. Every key has a button too.
5. **Flags become cuts.** _Cut flagged retakes_ turns each `retake` mark into a rejected
   region running back to the speech onset that opened the line (or the previous flag,
   whichever is later — two retakes in a row must not overlap).
6. **Remove pauses** is now an edit you accept, not a checkbox at publish time. The
   candidates are drawn before you accept them, and undo takes them back.
7. **Undo** across the whole pass — a list of past EDLs.
8. **Flag live from the keyboard** — `F` marks, `R` condemns the line just said.

## New machinery

- **`peaks.ts`** — `computePeaks` (one byte per bin, 100 bins/s), `encodePeaks`/`decodePeaks`
  (8-byte header so a future bin rate cannot silently misread today's files), `peakAtSec`,
  `peaksForColumns` (max-reduce to pixel columns; repeats the nearest bin when a short take
  has fewer bins than columns). `opfsPeaks.ts` stores them in their own OPFS directory, so a
  reconcile pass can tell a take (irreplaceable) from a derived artefact (recomputable).
- **`derush.ts`** — the whole pass as pure edits: `rejectTakeRange` (split-plus-drop),
  `relayoutSpeech` (the ripple), `applyCuts`, `retakeRange`/`retakeRanges`,
  `keptRangesForTake`/`keptDurationForTake`, `setClipMuted`/`setTakeMuted`/`soloTake`,
  `nextShuttleRate`, `flagBefore`/`flagAfter`, `nextKeptSec`.
- **`history.ts`** — `historyOf`/`commit`/`undo`/`canUndo` over plain snapshots. No redo, on
  purpose: it is one more thing to invalidate on the next edit.
- **`analyzeTake.ts`** — `analyzeDecoded` (pure) and `analyzeTakeFile` (decode + analyse).
  Duration comes from the sample count, not the container header, because the EDL indexes
  into those samples and a few frames of disagreement would render silence at a seam.
- **`pauses.ts` + `speechOnsets`** — every silence-to-speech transition, from the same
  envelope as the silences, so the two overlays can never disagree.
- **`components/studio/TakeWaveform.vue`** — canvas, all overlays, click to seek, drag to set
  a region. **`components/studio/DerushPanel.vue`** — take list, transport, keyboard, edits.
- **`publishSession.ts`** replaces `publishTake.ts` — renders the session (decoding only the
  takes still in use), refuses when the timeline is empty.

## The two decisions this slice made

**Everything the review UI touches is in take seconds, never timeline seconds.** A flag
stamped at capture, a pause candidate found afterwards, and a waveform column all refer to
the same axis, and that axis does not move when an edit ripples. The timeline is derived —
`relayoutSpeech` lays the surviving clips end to end and is the only thing that knows about
ripple. This is what makes "reject a region" and "accept a pause cut" literally the same
function.

**The one-button tap/double-tap flag is dropped; it is two buttons and two keys.** The plan
argued for one button because you have no attention to spare mid-take. That is the right
premise and the wrong conclusion: a double-tap cannot resolve a tap until its window
expires, so the mark you feel you placed lands late, and a second tap that misses the window
becomes two marks — silently, in the one moment where you will not be checking. Two targets
cost one more button and are unambiguous at any speed. `F` marks, `R` condemns.

## Verified, not assumed

**Verified:** `pnpm build` clean (zero warnings, font `@import` still line 1 of the built
CSS), `pnpm lint`, `pnpm fmt:check`, `pnpm test:run` = **186 tests** green (was 125). New
coverage: peaks round-trip and column reduction, every derush edit (split, ripple, edge
shorten, whole-clip drop, composition, cross-take isolation), retake-region derivation, mute
and solo, shuttle ladder, flag jumps, kept-playback skipping, the undo stack, the analysis
agreeing with itself (every cut inside a detected silence), and a mounted `DerushPanel`
proving the keys reach the right pure function and stay out of the way while you type.

**Not yet verified — the same live-browser gate slice 4 left open, plus this slice's own:**

- Everything on slice 4's list: live mic capture, OPFS write/read, `MediaRecorder` MIME,
  WebCodecs Opus producing a playable blob, the −16 ±1 LUFS / −1 dBFS measurement over a
  published blob, the `.pub.md` round trip, and iOS Safari.
- The waveform against a real take (canvas is not exercised in jsdom).
- Reverse shuttle on a real media element, and whether seeking backwards at 4× is smooth
  enough to be useful or should step in coarser jumps.
- Peaks written and read back from OPFS.

## Gotchas

- **A lowercase `select` token anywhere in a source file costs 8.5 kB of CSS.** Tailwind
  scans `./**/*.{vue,ts}` for candidates, and daisyUI emits its whole `.select` component
  when it sees one. The waveform's region event was called `select`; renaming it to `region`
  took the main CSS bundle back from 78.3 kB to 69.9 kB. Same class of problem as the
  markdown-scan bug documented at the top of `src/style.css`. Check the CSS size after
  adding a component.
- **The playhead follows the media element only while the transport is running.** Paused, it
  is whatever the last seek set. A media element that quietly refuses to move must not drag
  the marker back to zero under the cursor — and it makes the panel testable in jsdom.
- **`encodePeaks` is typed `Uint8Array<ArrayBuffer>`, not `Uint8Array`.** The OPFS writer
  will not accept a view that might sit on a `SharedArrayBuffer`.
- Slice 4's gotchas all still hold: the vitest/vite type split, esbuild's `allowBuilds`
  decision, mediabunny's `copyToChannel` needing an ArrayBuffer-backed view.

## Deltas from the plan (deliberate, for slice 6+ to close)

- **Chapters have no UI.** `projectChapterToTimeline` has worked since slice 4 and nothing
  drops a chapter marker yet. It is a button and a list.
- **Render is still synchronous**, not a Worker.
- **Recover-session is still half-wired** — `listTakePaths` + `checkQuota` exist, no
  reconcile-on-open banner.
- **Split has no key of its own.** Rejecting a region splits as a side effect, which covers
  the derush case; a bare split (for a cue insertion point) waits for slice 6.
- **Best-of-N is per take, not per clip.** `setClipMuted` is there and tested; the UI mutes
  and solos whole takes, which is what "another take of that line" actually means today.

## After this handover was written

Three fixes landed on top of the slice, all still without a browser to check them in:

- `d8afd4d` — picked notes show they were picked; the service worker registration is polled
  hourly so a long-lived tab still sees the update toast; PWA dev options on.
- `414b17f` — a wedged `isRecording` flag could hide the update toast forever; the recorder
  now clears it on every exit path, with specs for `NewVersion` and `useTakeRecorder`
  (`src/test/pwaRegisterStub.ts` stubs `virtual:pwa-register/vue` for vitest).
- `6e965ba` — the real reason the toast was invisible: `App.vue` put `z-index: 1` on `.nav`,
  `main` and `.footer`, so a body-teleported overlay painted underneath all three. Removing
  that floor let the toast drop its `z-index: 100`. **Any new fixed overlay in this app needs
  an explicit z-index above 1** — see `.ai/lessons.md`.

The test count is **194** as of `3673269`, not the 186 quoted above.

## Where slice 6 starts — the cue track

The snap targets slice 6 needs already exist and are already drawn: flags, speech onsets,
pause-cut boundaries and clip boundaries all come out of `derush.ts` and `analyzeTake.ts` in
take seconds. What slice 6 adds is the cue track itself — `{kind:"file"}` clips for imported
music and `{kind:"bed"}` clips for the procedural engine, per-cue `duck` and fades, and a
snap index over the targets above. `assembleSpeech` skips non-take sources today; that is
the function to generalise.

## Guardrails carried forward

- **Never `putRecord` a note.** The studio publishes a recording and hands back a link.
- `canEncodeAudio("opus")` gate at session start — refuse clearly, no fallback.
- Suppress the `NewVersion` toast while recording.
- Font `@import` stays line 1 of `src/style.css`; `#ffa4c0` chrome byte-identical; no
  `/ambient`; do not touch `remanso-jetstream`; sessions are not shared with remanso.space.
- Test config stays in the standalone `vitest.config.ts`, out of every tsconfig.
