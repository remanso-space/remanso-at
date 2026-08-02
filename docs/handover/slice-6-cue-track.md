# Slice 6 — the cue track: music, sounds, ambient

Built 2026-08. **Code-complete, all build gates green, not yet verified against a live
microphone or a real import** — the same gate slices 4 and 5 left open, for the same reason
(no browser extension connected in the session that built it). Read slice 5's handover first;
this file covers only what slice 6 added and where slice 7 could start.

Plan doc: `/home/jean/.claude/plans/looking-at-the-remanso-whimsical-island.md`.
Slice 5: `docs/handover/slice-5-derush.md`.

## What shipped

A second track under the speech. The EDL was multi-track from day one (slice 4); slice 6 is
the first thing to put clips on the cue track — procedural ambient beds and imported
music/sound files — plus the two-stage mix that lands them under the voice, a snap index for
placing them, and chapter markers.

1. **A procedural bed engine** — `beds.ts`, `renderBed(bed, seed, startSample, count, out)`.
   A seeded pure function of the absolute sample index: the value at any index is a
   deterministic function of `(bed, seed, index)` alone, so a window from the middle of the
   stream is bit-identical to the same slice of a full render. Seven beds:
   `rain river wind surf brown pink roomTone`, filtered-noise families only.
2. **Imported files** as `{kind:"file"}` cue clips — `cueImport.ts` reuses remanso.space's
   `audioMimeType` verbatim (Android SAF empty-MIME workaround), `opfsCues.ts` stores them in
   their own OPFS directory beside the takes.
3. **Two-stage mix** — `assemble.ts`. `assembleSpeech` unchanged; new `assembleCues` lays the
   cue track (beds rendered procedurally, files from decoded PCM). `renderSession` runs the
   chain over the SPEECH ONLY, then sums the cues, then a final brick-wall limiter guards the
   ceiling. A session with no cues renders byte-for-byte as it did before slice 6.
4. **Per-cue duck and fades** — `duck.ts`. `duck: "under-speech"` multiplies the cue by an
   envelope driven by the *offline* speech (300 ms attack, 800 ms release), built from the
   same `detectSilences` the review pass already ran. Fades default to 2 s in / 4 s out for a
   long bed and ~30 ms for a short sting (`defaultFades`).
5. **A snap index** — `snap.ts`, `snapPoints`/`snapToNearest` over clip boundaries, flags,
   speech onsets and chapters, all projected to timeline seconds through the EDL. Placing a
   sting on a speech onset lands it on the first word.
6. **Room-tone fill** — `addRoomToneFill` lays a low room-tone bed under the whole programme,
   from the same engine; excluded from the bitrate tier because it is an inaudible floor.
7. **Bitrate reacts to content** — `mediaCodec.ts` gained a `ContentTier`
   (`speech` 64 / `occasional-cue` 96 / `music-heavy` 128 kbps) and `contentTier(session)`;
   `bitrateFor` and `minutesAtTier` take the tier, and the panel surfaces the tension.
8. **Chapters** — `addChapter`/`removeChapter`, dropped against a take at the playhead (`C`
   in the derush panel), projected to the timeline at render, a snap target for free.

## New machinery

- **`beds.ts`** — `renderBed`/`renderBedBuffer`, `BED_IDS`. RBJ biquads local to the module;
  white noise a stateless index hash; pink (Paul Kellet), brown (leaky integrator) steppers.
  Modulated filters recompute coefficients only at absolute-index block boundaries so a
  windowed render hits the same boundaries as a whole render. A `tanh` softclip bounds every
  bed to (−1, 1) against a resonant filter ringing past full scale on an unlucky seed.
- **`duck.ts`** — `duckEnvelope`, presence from `detectSilences`, attack/release follower.
- **`snap.ts`** — `snapPoints`, `snapToNearest`.
- **`cueImport.ts`** — `audioMimeType` (verbatim), `cueExtension`.
- **`opfsCues.ts`** — `writeCueFile`/`readCueFile`/`deleteCueFile`/`listCuePaths`, dir `cues`.
- **`edl.ts`** — `cueTrack`, `hasCueClips`, `addBedClip`, `addCueFileClip`, `addRoomToneFill`,
  `defaultFades`, `setCueClipMuted`/`setCueClipDuck`/`setCueClipGainDb`/`removeCueClip`,
  `addChapter`/`removeChapter`, and `projectTakeTimeToTimeline` (which `projectChapterToTimeline`
  now delegates to and the snap index reuses).
- **`components/studio/CueTrackPanel.vue`** — bed picker, file import, room-tone fill, the
  snap-target place-at picker, the bitrate line, per-clip duck/mute/remove. Placement is by
  snap target, not free drag — no timeline canvas.
- `DerushPanel.vue` gained the chapter drop (`C`) and a chapter list.
- `publishSession.ts` decodes file cues, passes `cuePcm` to `renderSession` and the tier to
  `encodeOpus`.

## The decisions this slice made

**The bed engine is a function of the sample index, not a node graph.** A graph driven by
`Math.random()` LFOs is neither seedable nor windowable, and once the renderer windows the
timeline you would have to write the whole thing again as plain samples. So it is written once
as samples. Position-addressability without carried state comes from a stateless noise source
plus replay-from-origin for the stateful parts — O(startSample), which is exactly right
because a bed clip renders once in a forward pass. The `/ambient` page was cut, so this engine
gets no live page to shake bugs out of before the renderer depends on it; the windowed-equality
property is asserted directly, the same shape as `renderChain.spec.ts`.

**Two stages, one sum.** The chain processes speech only; cues are summed onto the finished
voice afterward. Running the expander over music stops it gating room tone, and the compressor
pumps the bed against every syllable — so a cue never enters the chain.

**Ducking is offline.** The key is the speech envelope `detectSilences` already computed, not a
realtime sidechain — strictly better (the reduction is in place before the word starts) and
free (the analysis already ran).

## Verified, not assumed

**Verified:** `pnpm build` clean (zero warnings, font `@import` still line 1 of the built CSS,
main CSS bundle back to **69.89 kB** with no leaked daisyUI component), `pnpm lint`,
`pnpm fmt:check`, `pnpm test:run` = **257 tests** green (was 194). New coverage: the bed
windowed-equality property for every bed, seed sensitivity, spectral shape (brown bass-heavy,
rain high-passed, river band-limited) and levels (room tone −55..−65 dBFS, every bed in
[−1, 1]); the duck envelope (down under speech, up in the gap, attack faster than release);
`assembleCues` (bed render, file placement, duck applied vs spared, muted excluded);
`renderSession` unchanged with no cues and ceiling-held with a cue; the snap index (clip
boundaries, flag projection through a ripple, onset/chapter targets, de-dup, nearest-within-
tolerance and free placement); the bitrate tiers and `contentTier`; the cue EDL ops, chapters
and `defaultFades`; the MIME/extension logic; and mounted `CueTrackPanel`/`DerushPanel` specs
proving the buttons and the `C` key reach the right pure function.

**Not yet verified — the live-browser gate:**

- Every bed *heard*, not just measured — that rain sounds like rain and wind like wind, and
  that the seeds pick pleasant instances. The spectral tests prove the filters, not the taste.
- The two-stage mix on a real render: the bed sitting 12–16 LU under the voice, the duck
  breathing under real speech, the final limiter not audibly pumping on a music-heavy episode.
- File import end to end: the SAF workaround on a real Android pick, OPFS quota with a 40 MB
  music file plus takes on Safari, and `readAudioDuration` on a streamed container (it resolves
  0 on error and the import refuses — untested against a real odd file).
- Everything slice 4/5 left open: live mic, OPFS write/read, the −16 ±1 LUFS / −1 dBFS
  measurement over a published blob, the `.pub.md` round trip, iOS Safari.

## Gotchas

- **A daisyUI component leaks from a word in a *comment*, not just a class or event.** The word
  `dropdown` in a `CueTrackPanel` comment emitted the whole `.dropdown` component — 2.6 kB —
  because Tailwind scans comments too. Same class as the `select` bug (slice 4) and the
  markdown-scan bug at the top of `src/style.css`, but wider: **watch the CSS bundle after
  adding any component, and keep daisyUI component words (`dropdown`, `menu`, `select`, `input`,
  `card`, `range`, `steps`, `tab`, …) out of source entirely — comments included.** The build
  is back to the byte-identical 69.89 kB / `index-CwTpCUqy.css` only because that word is gone.
- **A file `<input>` and a bare `input` identifier are fine** (`.input` is already emitted by
  a pre-existing token); the leak was strictly the comment word.
- Slice 4/5 gotchas all still hold: take seconds never timeline seconds; `encodePeaks` typed
  `Uint8Array<ArrayBuffer>`; the vitest/vite type split; `copyToChannel` needing an
  ArrayBuffer-backed view; any new fixed overlay needs an explicit z-index above 1.

## Deltas from the plan (deliberate, for slice 7+ to close)

- **Placement is by snap target, not free drag.** A cue is placed at a chosen snap point (or
  start); there is no draggable clip on a timeline canvas. This lands a sting on an onset
  without a canvas nobody would finish, but moving a placed clip means remove-and-replace.
- **No per-clip gain slider in the UI.** `setCueClipGainDb` exists and is tested; the panel
  toggles duck/mute and removes, but the bed's −14 dB default and a file's 0 dB are not yet
  adjustable from the UI.
- **`bitrateFor` reacts to the tier, but the render still runs synchronously**, not in a Worker
  (carried over from slice 4/5).
- **surf has no plan recipe**; it is brown → LP 1.5 kHz with a 0.09 Hz amplitude swell, a
  deliberate filtered-noise choice in the family's spirit.

## Guardrails carried forward (do not break)

- **Never `putRecord` a note.** The studio publishes a recording and hands back a link.
- **CC-BY must never enter the cue track.** Built-in beds are procedural and carry no licence;
  imported files are the user's own; the app builds no attribution machinery.
- `canEncodeAudio("opus")` gate at session start; suppress the `NewVersion` toast while
  recording; font `@import` line 1; `#ffa4c0` chrome byte-identical; no `/ambient`; do not touch
  `remanso-jetstream`; test config stays in the standalone `vitest.config.ts`.
