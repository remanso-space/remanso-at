# Slice 7 — music slots: an open-licence library

Built 2026-08-02. **Code-complete, all build gates green (284 tests, typecheck, lint, format), not yet verified against a live microphone or a real Openverse pick in the browser** —
the same gate slices 4, 5 and 6 left open. Read slice 6's handover first: this file replaces
most of what it describes.

Design doc: `docs/superpowers/specs/2026-08-02-music-slots-design.md`.
Slice 6: `docs/handover/slice-6-cue-track.md`.

## What changed, and why it replaced slice 6

Slice 6 built a cue track: place a clip at a snap target, set its gain, decide whether it
ducks. Two things were wrong with it.

The authoring model asked the author to think like an editor. What an author wants to say is
"something calm under the intro" — a slot, not a clip.

And the sound sources were not music. Procedural beds are filtered noise — rain, wind, room
tone. Slice 6 wrote down that CC-BY stayed out "by construction", which was true and was also
the reason the studio had no music in it at all.

Slots fix the first and an API fixes the second.

## What shipped

1. **Music slots** — `edl.types.ts`, `musicSlots.ts`. `Session.musicSlots` is a list of
   `{kind, anchor, lengthSec, inSec, gainDb, duck, pick}`. Three kinds with their own defaults:
   intro (0 s, 8 s, −6 dB, unducked), break (a chapter, 4 s, −12 dB, ducked), outro (the speech
   end, 10 s, −6 dB, unducked).
2. **The cue track is now a projection.** `cueClipsFromSlots(session)` derives clips on every
   read; nothing stores them. That is the load-bearing decision of the slice — a slot's length
   lives in exactly one place, so there is no stale clip to keep in sync, and undo stays a
   session snapshot. `newSession` builds the speech track alone.
3. **Looping fell out of the projection for free.** A short track under a long slot projects to
   repeated clips overlapping by a 0.5 s crossfade, which `assembleCues` already knew how to
   mix (it sums clips and fades them). No renderer change, no loop state. A track shorter than
   two crossfades plays once instead of stuttering.
4. **Openverse client** — `openverse.ts`. `searchMusic` and `fetchToOpfs`, `fetch` passed in so
   the specs need no network. Rows the studio cannot use are dropped at the mapper: no playable
   URL, a container it cannot decode, a licence outside CC0/CC-BY, no duration.
5. **Attribution** — the recording lexicon gained `credits` (`#credit`: title, creator, license,
   licenseUrl, sourceUrl, max 64). `publishSession` collects CC-BY picks that actually play,
   de-dupes by `sourceUrl`, writes them into the record and appends credit lines under the
   markdown link. CC0 publishes nothing, because CC0 asks for nothing.
6. **`MusicSlotPanel.vue`** replaces `CueTrackPanel.vue`. Anchors come from the existing
   `snapPoints` plus the chapters plus "after the last word". The picker previews straight from
   the provider CDN and writes to OPFS only when a result is picked.

## Facts worth not rediscovering

**Openverse needs no API key, and should not have one.** The anonymous limit is 20 requests per
minute and 200 per day, counted per client IP. In a SPA that means each author spends their own
budget against their own address; a registered key would pool every author onto one quota and
put a secret in the bundle.

**Jamendo is unusable and it is the one that hurts.** It is the only one of Openverse's three
audio providers that is a music catalogue proper. Its storage host answers with
`access-control-allow-origin` pinned to an unrelated origin, so the browser cannot read the
bytes — and a mix needs samples, not a playable URL. It is excluded in the query string rather
than filtered out of the results, so the pool an author browses is the pool the studio can
render. Verified with a `curl -H "Origin: https://remanso.at"` range request against
`prod-1.storage.jamendo.com`; Freesound's CDN and `upload.wikimedia.org` both answer `*`.

**Freesound URLs are 128 kbps mp3 previews.** The originals need Freesound's own OAuth. For
music under speech at the studio's own 96–128 kbps Opus target this is not the weak link.

**CC-BY-SA is excluded on purpose.** A recording is a derivative work, so share-alike would
push its terms onto the whole episode.

**Two duration functions, one direction of dependency.** `edl.speechDurationSec` is the spoken
programme and is what anchors are measured against; `musicSlots.programmeDurationSec` is the
rendered length, speech plus any music running past it (an outro does). `musicSlots` imports
`edl`, never the reverse — that is why `timelineDurationSec` was split rather than extended.

**`speech-end` is its own anchor kind**, not an absolute second fixed when the slot was made, so
an outro follows the last word through every later edit.

**No migration was needed.** The studio's EDL is not persisted between page loads — only takes
and cue files are, in OPFS — so no stored session carries a `bed` or `file` clip.

## Removed

`beds.ts`, `cueImport.ts`, `CueTrackPanel.vue` and their specs. `BedId`, `ClipSource`'s `bed`
and `file` variants, and the cue-clip edit operations in `edl.ts` (`addBedClip`,
`addCueFileClip`, `addRoomToneFill`, `setCueClip*`, `removeCueClip`, `defaultFades`).
`opfsCues.ts`, `duck.ts` and `snap.ts` all stay — the first now holds fetched music.

What was lost with the beds: a zero-licence, zero-network, arbitrarily long ambient source, and
the room-tone fill that papered over a pause cut's dead-silent seam. If the seam turns out to
matter once the studio is used live, it comes back as a slot kind with a procedural source, not
as a return of the cue track.

## Where slice 8 could start

- **Verify in a browser.** Pick a track, render, publish, and read the record back: the
  `credits` field is new and has never been through a PDS.
- **Trim inside a slot.** `inSec` exists and nothing sets it but the panel's reset-on-fill.
  Picking the good 8 seconds out of a 3-minute pad is the obvious next control.
- **`/listen` should render credits.** The field is written and nothing reads it yet.
- **Pagination.** `searchMusic` takes a page and the panel never asks for a second one.
