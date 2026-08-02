// The edit list over immutable takes — the studio's data model (plan: "Studio
// architecture"). Capture is honest: takes are recorded once and never rewritten,
// and every edit (trim, split, pause-removal, cue placement) is a field mutation on
// this structure. The renderer projects it to audio; nothing here touches bytes.
//
// Multi-track from day one on purpose: derush (slice 5) and cues (slice 6) both need
// a second track, and retrofitting one into a single-track mix loop is expensive while
// designing it in is nearly free. Slice 4 only populates the speech track.

/** The whole capture pipeline is pinned to 48 kHz — see the plan's capture notes. */
export const SESSION_SAMPLE_RATE = 48_000

/** Procedural ambient beds (slice 6). Named here so ClipSource can reference them. */
export type BedId = "rain" | "river" | "wind" | "surf" | "brown" | "pink" | "roomTone"

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
  | { kind: "file"; opfsPath: string } // imported music / sound effect
  | { kind: "bed"; bedId: BedId; seed: number } // procedural, infinite, position-addressable

/**
 * One region of a source placed on the timeline. Trim is `inSec`/`outSec`; split makes
 * two clips that share a source; `atSec` is where it lands. Cue-only fields (`duck`,
 * fades) are inert on speech clips.
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
  kind: "speech" | "cue"
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
  /** The timeline — [speech, cue]. */
  tracks: Track[]
  chapters: Chapter[]
  chain: ChainSettings
}
