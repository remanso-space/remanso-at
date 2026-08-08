import type { PublicNoteBlob } from "./publicNote.types"
import { RECORDING_COLLECTION, type RecordingCredit } from "./recording.types"
import { getActiveSession } from "vue-atproto-login"

interface UploadRecordingParams {
  did: string
  file: File
  title: string
  durationSec?: number
  /**
   * Overrides `file.type` for the upload. Android's file picker hands back an
   * empty or generic MIME for some containers, and the lexicon's blob accept is
   * ["audio/*"] — an untyped blob would fail record validation.
   */
  mimeType?: string
  /**
   * The rkey to write at, which is the rkey of the note this recording belongs to. Absent
   * means no note was picked: the PDS assigns a TID and the recording stands on its own.
   */
  rkey?: string
  /** Omitted from the record when empty. */
  credits?: RecordingCredit[]
}

export type UploadRecordingResult =
  | { ok: true; uri: string }
  | { ok: false; reason: "no-session" }
  | { ok: false; reason: "upload-failed"; detail: string }
  | { ok: false; reason: "record-failed"; detail: string }
  | { ok: false; reason: "exception"; detail: string }

/**
 * The `{ error, message }` body is the only thing distinguishing BlobTooLarge from
 * InvalidMimeType from an expired token, so it is surfaced to the user.
 */
const describeFailure = async (response: Response): Promise<string> => {
  const status = response.status
  try {
    const body = (await response.json()) as { error?: string; message?: string }
    const parts = [body.error, body.message].filter(Boolean)
    return parts.length ? `${status} ${parts.join(": ")}` : `HTTP ${status}`
  } catch {
    return `HTTP ${status}`
  }
}

/**
 * With an `rkey`, putRecord writes at the note's own rkey — that shared rkey *is* the
 * attachment. Overwriting is wanted: a second cut replaces the first rather than leaving two
 * recordings and no way to tell which one the note means. Without an rkey, createRecord takes
 * a PDS-assigned TID.
 *
 * The record is written immediately after the upload because an unreferenced blob is garbage
 * collected with roughly an hour of grace — the reference cannot wait for the publish cycle.
 */
export const uploadRecording = async ({
  did,
  file,
  title,
  durationSec,
  mimeType,
  rkey,
  credits,
}: UploadRecordingParams): Promise<UploadRecordingResult> => {
  const session = await getActiveSession(did)
  if (!session) return { ok: false, reason: "no-session" }

  try {
    const uploaded = await session.fetchHandler("/xrpc/com.atproto.repo.uploadBlob", {
      method: "POST",
      headers: { "Content-Type": mimeType || file.type },
      body: file,
    })

    if (!uploaded.ok) {
      const detail = await describeFailure(uploaded)
      console.warn("uploadRecording: uploadBlob failed", detail)
      return { ok: false, reason: "upload-failed", detail }
    }

    const { blob } = (await uploaded.json()) as { blob: PublicNoteBlob }

    const method = rkey ? "putRecord" : "createRecord"
    const created = await session.fetchHandler(`/xrpc/com.atproto.repo.${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: did,
        collection: RECORDING_COLLECTION,
        ...(rkey ? { rkey } : {}),
        record: {
          audio: blob,
          title,
          ...(durationSec ? { durationSec } : {}),
          ...(credits?.length ? { credits } : {}),
          createdAt: new Date().toISOString(),
        },
      }),
    })

    if (!created.ok) {
      const detail = await describeFailure(created)
      console.warn(`uploadRecording: ${method} failed`, detail)
      return { ok: false, reason: "record-failed", detail }
    }

    const { uri } = (await created.json()) as { uri: string }
    if (!uri) {
      return { ok: false, reason: "record-failed", detail: "no uri returned" }
    }
    return { ok: true, uri }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn("uploadRecording: failed", error)
    return { ok: false, reason: "exception", detail }
  }
}
