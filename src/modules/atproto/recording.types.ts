import type { PublicNoteBlob } from "./publicNote.types"

// Hand-written from lexicons/space/remanso/recording.json — the record the studio
// will publish (slice 4) and /listen will browse (slice 7).
export const RECORDING_COLLECTION = "space.remanso.recording"

// Mirrors the lexicon's maxSize. The PDS enforces its own ceiling too
// (PDS_BLOB_UPLOAD_LIMIT, 50MB by default), so rejecting here just gives a
// better error than a failed upload.
export const MAX_RECORDING_BYTES = 50_000_000

export interface Recording {
  audio: PublicNoteBlob
  title?: string
  durationSec?: number
  recordedAt?: string
  createdAt: string
}
