// Takes are recorded once and never rewritten; every edit is a field mutation on this
// structure. Only the speech track is stored — the cue track is projected from the music
// slots on every read (see musicSlots.ts).

/** The whole capture pipeline is pinned to 48 kHz. */
export const SESSION_SAMPLE_RATE = 48_000

export type SlotKind = "intro" | "break" | "outro"

/** CC0 asks for no attribution, but the credit is kept so the panel can show what was picked. */
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

/**
 * A chapter anchor follows its mark through every later edit, and resolves to nothing if a
 * trim took that mark out.
 */
export type SlotAnchor =
  | { kind: "absolute"; atSec: number }
  | { kind: "chapter"; chapterIndex: number }
  | { kind: "speech-end" }

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
   * Open a real silence under the break, sliding the rest of the programme later. Only a
   * `break` acts on it. Optional so every stored session predating the flag reads as off.
   * See `applySpeechBreaks`.
   */
  pauseSpeech?: boolean
  pick: MusicPick | null
}

/** Stored against take time, so a flag survives every later trim and pause-removal. */
export interface Marker {
  atTakeSec: number
  kind: "mark" | "retake"
}

/** Immutable, append-only. A take's bytes live in one OPFS file; nothing rewrites them. */
export interface Take {
  id: string
  opfsPath: string
  durationSec: number
  peaksPath: string
  flags: Marker[]
  label: string
}

export type ClipSource =
  | { kind: "take"; takeId: string }
  | { kind: "music"; opfsPath: string; credit: MusicCredit }

/** One region of a source placed on the timeline. `duck` is inert on speech clips. */
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
  /** A muted clip is kept in the EDL but not rendered. */
  muted?: boolean
}

export interface Track {
  id: string
  kind: "speech"
  clips: Clip[]
  gainDb: number
}

/** Held in take time, projected through the EDL to a timeline second at render. */
export interface Chapter {
  takeId: string
  atTakeSec: number
  title?: string
}

/**
 * The limiter is a clip guard, not a compressor. Loudness normalises to -16 LUFS over every
 * rendered sample (two-pass), not the polled estimate loudness.ts computes live.
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
  takes: Take[]
  tracks: Track[]
  chapters: Chapter[]
  musicSlots: MusicSlot[]
  chain: ChainSettings
}
