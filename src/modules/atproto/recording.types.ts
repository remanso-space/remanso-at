import type { PublicNoteBlob } from "./publicNote.types"

// Hand-written from lexicons/space/remanso/recording.json.
export const RECORDING_COLLECTION = "space.remanso.recording"

// Mirrors the lexicon's maxSize. The PDS enforces its own ceiling too
// (PDS_BLOB_UPLOAD_LIMIT, 50MB by default), so rejecting here just gives a
// better error than a failed upload.
export const MAX_RECORDING_BYTES = 50_000_000

/** Mirrors the lexicon's `#credit`: one openly licensed work and where its terms live. */
export interface RecordingCredit {
  title: string
  creator: string
  license: string
  licenseUrl: string
  sourceUrl: string
}

export interface Recording {
  audio: PublicNoteBlob
  title?: string
  durationSec?: number
  recordedAt?: string
  /** Attribution for music that requires it. CC0 tracks are absent by design. */
  credits?: RecordingCredit[]
  createdAt: string
}
