// The edit list over immutable takes — the studio's data model (plan: "Studio
// architecture"). Capture is honest: takes are recorded once and never rewritten,
// and every edit (trim, split, pause-removal, cue placement) is a field mutation on
// this structure. The renderer projects it to audio; nothing here touches bytes.
//
// Multi-track from day one on purpose: derush and music both need a second track, and
// retrofitting one into a single-track mix loop is expensive while designing it in is nearly
// free. Only the speech track is stored, though — the cue track is projected from the music
// slots on every read (see musicSlots.ts), so a slot's length lives in exactly one place.

/** The whole capture pipeline is pinned to 48 kHz — see the plan's capture notes. */
export const SESSION_SAMPLE_RATE = 48_000

/** What a music slot marks: an opening, a beat between chapters, a close. */
export type SlotKind = "intro" | "break" | "outro"

/**
 * Where a track came from and under what terms. Carried on the clip so the renderer, the
 * panel and the publisher all read the same object, and written into the published record
 * for CC-BY. CC0 asks for nothing, but the credit is kept anyway so the panel can show the
 * author what they picked, and so a licence added to the pool later needs no new field.
 */
export interface MusicCredit {
  title: string
  creator: string
  license: "cc0" | "by"
  licenseUrl: string
  sourceUrl: string
}

/** A track fetched from Openverse and stored in OPFS, ready to fill a slot. */
export interface MusicPick {
  opfsPath: string
  sourceDurationSec: number
  credit: MusicCredit
}

/**
 * What a slot hangs off. An absolute anchor is a timeline second (a snap target the derush
 * pass already found); a chapter anchor follows its mark through every later edit, and
 * resolves to nothing if a trim took that mark out.
 */
export type SlotAnchor =
  | { kind: "absolute"; atSec: number }
  | { kind: "chapter"; chapterIndex: number }
  | { kind: "speech-end" }

/**
 * A named moment with music under it. Slots are the authoring surface and the source of
 * truth: the cue track is projected from them at render (see musicSlots.ts) rather than
 * stored, so a slot's length and gain live in exactly one place.
 */
export interface MusicSlot {
  id: string
  kind: SlotKind
  anchor: SlotAnchor
  lengthSec: number
  /** Into the picked source — where in the track the slot starts playing. */
  inSec: number
  gainDb: number
  duck: boolean
  /**
   * A "real break": open a silence under it. The speech stops at the break, the music plays
   * into the gap, and the rest of the programme slides later by the break's length — instead
   * of the music playing over speech that keeps going. Only a `break` acts on it. Optional so
   * every stored session predating the flag reads as off. See `applySpeechBreaks`.
   */
  pauseSpeech?: boolean
  pick: MusicPick | null
}

/**
 * A live flag, appended while recording (plan: "flag-while-recording"). Same button:
 * a tap marks a spot, a double-tap says the last line was bad and will be retaken.
 * Stored against take time so it survives every later trim and pause-removal.
 */
export interface Marker {
  atTakeSec: number
  kind: "mark" | "retake"
}

/** Immutable, append-only. A take's bytes live in one OPFS file; nothing rewrites them. */
export interface Take {
  id: string
  /** OPFS path of the encoded capture (one file per take). */
  opfsPath: string
  durationSec: number
  /** OPFS path of the precomputed peaks for the waveform. */
  peaksPath: string
  /** Flags written live while recording. */
  flags: Marker[]
  label: string
}

export type ClipSource =
  | { kind: "take"; takeId: string } // recorded speech
  | { kind: "music"; opfsPath: string; credit: MusicCredit } // an openly licensed track in OPFS

/**
 * One region of a source placed on the timeline. Trim is `inSec`/`outSec`; split makes
 * two clips that share a source; `atSec` is where it lands. `duck` is inert on speech clips.
 */
export interface Clip {
  id: string
  source: ClipSource
  /** Into the source. */
  inSec: number
  outSec: number
  /** On the timeline. */
  atSec: number
  gainDb: number
  fadeInSec: number
  fadeOutSec: number
  /** Cue clips only; "under-speech" ducks against the speech envelope at render. */
  duck: "none" | "under-speech"
  /** Best-of-N solo (slice 5): a muted clip is kept in the EDL but not rendered. */
  muted?: boolean
}

export interface Track {
  id: string
  kind: "speech"
  clips: Clip[]
  gainDb: number
}

/** {takeId, atTakeSec} — projected through the EDL to a timeline second at render. */
export interface Chapter {
  takeId: string
  atTakeSec: number
  title?: string
}

/**
 * The re-runnable render chain over the speech track. HPF and presence are biquads;
 * expander and compressor share loudness.ts's transposed-direct-form biquad shape.
 * The limiter is a clip guard, not a compressor. Loudness normalises to -16 LUFS
 * over every rendered sample (two-pass), not a polled estimate.
 */
export interface ChainSettings {
  hpfHz: number
  presenceDb: number
  expanderThresholdDb: number
  compressorThresholdDb: number
  targetLufs: number
  limiterCeilingDb: number
}

export interface Session {
  id: string
  title: string
  sampleRate: typeof SESSION_SAMPLE_RATE
  /** Immutable, append-only. */
  takes: Take[]
  /** The timeline. Only the speech track is stored; the cue track is projected from slots. */
  tracks: Track[]
  chapters: Chapter[]
  /** Music under the programme. Projected onto the cue track at render. */
  musicSlots: MusicSlot[]
  chain: ChainSettings
}
