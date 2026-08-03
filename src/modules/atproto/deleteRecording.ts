import { RECORDING_COLLECTION } from "./recording.types"
import { getActiveSession } from "./service/atprotoOAuth"

// The other half of the studio: a recording written to the author's PDS can be taken back
// off it. deleteRecord is authenticated and only ever touches the caller's own repo — the
// PDS rejects a delete against any DID but the session's — so /listen only offers this on
// your own recordings, and the button carries its own typed-confirmation friction.

interface DeleteRecordingParams {
  /** The signed-in author's DID; the session is looked up from it. */
  did: string
  /** rkey of the recording record to remove. */
  rkey: string
}

export type DeleteRecordingResult =
  | { ok: true }
  | { ok: false; reason: "no-session" }
  | { ok: false; reason: "delete-failed"; detail: string }
  | { ok: false; reason: "exception"; detail: string }

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
 * Delete one recording record from the author's own PDS. Idempotent by nature of
 * deleteRecord: removing an rkey that is already gone still returns ok. The audio blob it
 * referenced becomes unreferenced and the PDS garbage-collects it on its own.
 */
export const deleteRecording = async ({
  did,
  rkey,
}: DeleteRecordingParams): Promise<DeleteRecordingResult> => {
  const session = await getActiveSession(did)
  if (!session) return { ok: false, reason: "no-session" }

  try {
    const res = await session.fetchHandler("/xrpc/com.atproto.repo.deleteRecord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: did,
        collection: RECORDING_COLLECTION,
        rkey,
      }),
    })

    if (!res.ok) {
      const detail = await describeFailure(res)
      console.warn("deleteRecording: deleteRecord failed", detail)
      return { ok: false, reason: "delete-failed", detail }
    }

    return { ok: true }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.warn("deleteRecording: failed", error)
    return { ok: false, reason: "exception", detail }
  }
}
