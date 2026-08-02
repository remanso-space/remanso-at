# Music slots — design

Replaces the cue track (slice 6) with named slots filled from an open-licence music API.

## Why

The cue track asks the author to think like an editor: pick a snap target, place a clip, set its
gain, decide whether it ducks. What an author actually wants is "something calm under the intro" —
a slot, not a clip. And the built-in sound sources were procedural beds, which are filtered noise:
rain, wind, room tone. There was no music in the studio at all, because music means a licence and
the cue track deliberately built no attribution machinery.

Slots invert both. The author names the moment (intro, break, outro), the studio finds music for
it, and attribution rides along in the published record.

## Sources

Openverse (`api.openverse.org/v1/audio/`) aggregates openly licensed audio. No API key: anonymous
callers get 20 requests/minute burst and 200/day sustained, counted per client IP, so every user
spends their own budget and the SPA needs no proxy and holds no secret.

Three providers are indexed; two are usable:

| Source            | Items | Audio CORS                                        | Verdict                                      |
| ----------------- | ----- | ------------------------------------------------- | -------------------------------------------- |
| Freesound         | 591k  | `access-control-allow-origin: *`, Range supported | usable; 128 kbps mp3 previews                |
| Wikimedia Commons | 3.9M  | `*`                                               | usable                                       |
| Jamendo           | 628k  | ACAO pinned to an unrelated origin                | unusable — the browser cannot read the bytes |

Jamendo is the only one of the three that is a music catalogue proper, and it is the one the
browser cannot fetch. Mixing needs the samples, not a playable URL, so Jamendo is excluded at the
query rather than filtered out after the fact.

Licences are limited to `cc0` and `by`. Share-alike is excluded: a recording is a derivative, and
CC-BY-SA would push its licence onto the whole episode.

## Model

Slots are the source of truth. The cue track becomes a projection of them — derived at render
time, never stored — so there is exactly one place a slot's length, gain or anchor lives.

```ts
export type SlotKind = "intro" | "break" | "outro"

export interface MusicCredit {
  title: string
  creator: string
  license: "cc0" | "by"
  licenseUrl: string
  sourceUrl: string
}

export interface MusicPick {
  opfsPath: string
  sourceDurationSec: number
  credit: MusicCredit
}

export type SlotAnchor =
  | { kind: "absolute"; atSec: number }
  | { kind: "chapter"; chapterIndex: number }
  | { kind: "speech-end" }

export interface MusicSlot {
  id: string
  kind: SlotKind
  anchor: SlotAnchor
  lengthSec: number
  inSec: number
  gainDb: number
  duck: boolean
  pick: MusicPick | null
}
```

`Session.musicSlots` replaces the persisted cue `Track`. `ClipSource` loses `bed` and `file` and
gains `{ kind: "music"; opfsPath; credit }`.

Defaults per kind:

| Kind  | Anchor        | Length | Gain   | Duck |
| ----- | ------------- | ------ | ------ | ---- |
| intro | absolute, 0 s | 8 s    | −6 dB  | no   |
| break | chapter       | 4 s    | −12 dB | yes  |
| outro | speech-end    | 10 s   | −6 dB  | no   |

An `outro` anchored to the speech end runs past the last word, so the rendered timeline is
`max(speech end, furthest projected slot end)`. `speech-end` is its own anchor kind rather than an
absolute second fixed at creation time, so an outro follows the last word through every later edit.
It reads the _speech_ end, not the rendered end, so there is no circular definition.

## Projection

`musicSlots.ts` exports one function: `cueClipsFromSlots(session): Clip[]`.

- Resolve the anchor to a timeline second. A chapter anchor goes through the existing
  `projectChapterToTimeline`; a chapter whose mark was edited away yields no clips.
- A slot whose source is shorter than `lengthSec` emits repeated clips with a 0.5 s equal-power
  crossfade at each seam. Looping is therefore a projection concern and the renderer needs no
  change: it already sums overlapping clips and already fades them.
- Fades are 1 s in and out, clamped to `lengthSec / 3`.
- `duck` maps to the existing `"under-speech"` envelope.

`edl.ts` keeps `speechDurationSec` (the spoken programme, which anchors are measured against) and
`musicSlots.ts` owns `programmeDurationSec` (the rendered length). The dependency runs one way —
`musicSlots` imports `edl`, never the reverse. `assembleCues`, `hasMusic` and `contentTier` all read
the projection.

## Search

`openverse.ts`:

- `searchMusic({ query, page })` → `GET /v1/audio/?license=cc0,by&source=freesound,wikimedia_audio&page_size=20&q=…`
- Results map to `{ id, title, creator, license, licenseUrl, sourceUrl, audioUrl, durationSec, filetype }`.
  Rows with no playable `url`, or with a container the studio cannot decode, are dropped.
- `PRESET_QUERIES` is a static chip list, the entry point for authors who do not know what to type.
- `fetchToOpfs(result)` downloads and stores through the existing `writeCueFile`, returning a
  `MusicPick`.
- HTTP 429 surfaces as "search again in a minute" rather than a generic failure.
- `fetch` is a parameter, defaulting to the global, so the specs need no network stubbing hooks.

Specs run against a fixture captured from the live API with `fetch` mocked; nothing in CI touches
the network.

## UI

`MusicSlotPanel.vue` replaces `CueTrackPanel.vue`. One row per slot: kind badge, anchor selector
(snap targets from the existing `snapPoints`, plus chapters), length, gain, duck toggle, credit
line, remove. An unfilled slot opens the picker inline: chips, a free-text box, results with a
preview that streams straight from the provider CDN. Nothing is written to OPFS until a result is
picked.

## Publish

`space.remanso.recording` gains `credits`, an array (max 64) of
`{ title, creator, license, licenseUrl, sourceUrl }`. `publishSession` collects the picks whose
licence is `by`, de-duplicates them by `sourceUrl`, writes them into the record, and appends credit
lines beneath the markdown link the studio hands back. CC0 picks keep their credit in the session
for display and publish nothing, because CC0 asks for nothing.

`publishSession` also gains a `musicPcm` param beside `takePcm`: samples already decoded are passed
in, and only what is missing is read back from OPFS. Same shape as takes, and it is what makes the
credit path testable outside a browser.

## Removed

`beds.ts`, `cueImport.ts`, `CueTrackPanel.vue` and their specs; `BedId`; the bed and file branches
in `assemble.ts`, `mediaCodec.ts` and `publishSession.ts`; the cue-clip edit operations in
`edl.ts`. `opfsCues.ts` stays and now holds fetched music. `duck.ts` and `snap.ts` stay.

The studio's EDL is not persisted between page loads — only takes and cue files are, in OPFS — so
there is no stored session carrying old `bed` or `file` clips and no migration to write.

## Cost accepted

The render still runs offline: the network is touched once, when a track is picked, and the bytes
live in OPFS from then on. What is lost is the zero-licence, zero-network, infinitely long ambient
bed. What is gained is actual music, and a record that says where it came from.
