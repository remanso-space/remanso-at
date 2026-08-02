import { blobUrl, resolveActor } from "./resolveActor"
import { RECORDING_COLLECTION, type Recording } from "./recording.types"
import type { ListenRecording } from "./listRecordings"

// The everyone tier. `listRecordings` reads one repo straight off its PDS; this reads the
// appview, which is the only place that has seen every author's recordings — the PDS knows
// only its own. The appview returns flat rows (it does not hold the blobs), so each row's
// DID is resolved to its PDS to build a playable getBlob URL, exactly as the per-repo path
// does. The note link is left off here: the appview does not say whether a note sits at the
// recording's rkey, and a link to a note that may not exist is worse than none.

export const APPVIEW_BASE = "https://api.remanso.space"

/** One row of the appview's `/recordings` feed — flat, blob-less, already indexed. */
interface AppviewRecording {
  did: string
  rkey: string
  title?: string
  durationSec?: number
  recordedAt?: string | null
  createdAt: string
  blobCid: string
  mimeType: string
  size: number
}

export type ListAllRecordingsResult =
  | { ok: true; recordings: ListenRecording[]; cursor?: string }
  | { ok: false; reason: "list-failed" | "exception"; detail?: string }

const PAGE_LIMIT = 50

const feedUrl = (cursor?: string): string => {
  const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  if (cursor) query.set("cursor", cursor)
  return `${APPVIEW_BASE}/recordings?${query}`
}

// A DID's PDS never moves within a session; resolve each once and reuse across pages.
const pdsCache = new Map<string, string | null>()

const pdsFor = async (did: string): Promise<string | null> => {
  const cached = pdsCache.get(did)
  if (cached !== undefined) return cached
  const resolved = await resolveActor(did)
  const pds = resolved?.pds ?? null
  pdsCache.set(did, pds)
  return pds
}

const toListen = (row: AppviewRecording, pds: string): ListenRecording => {
  const value: Recording = {
    audio: { $type: "blob", ref: { $link: row.blobCid }, mimeType: row.mimeType, size: row.size },
    createdAt: row.createdAt,
  }
  if (row.title) value.title = row.title
  if (row.durationSec !== undefined) value.durationSec = row.durationSec
  if (row.recordedAt) value.recordedAt = row.recordedAt

  return {
    uri: `at://${row.did}/${RECORDING_COLLECTION}/${row.rkey}`,
    rkey: row.rkey,
    value,
    audioUrl: blobUrl({ pds, did: row.did, cid: row.blobCid }),
    note: null,
  }
}

/**
 * One page of everyone's recordings, newest first, from the appview index. Rows whose DID
 * will not resolve to a PDS are dropped rather than shown with an unplayable blob.
 */
export const listAllRecordings = async ({
  cursor,
}: { cursor?: string } = {}): Promise<ListAllRecordingsResult> => {
  try {
    const res = await fetch(feedUrl(cursor))
    if (!res.ok) return { ok: false, reason: "list-failed", detail: `HTTP ${res.status}` }

    const body = (await res.json()) as { recordings: AppviewRecording[]; cursor?: string }

    const mapped = await Promise.all(
      body.recordings.map(async (row) => {
        const pds = await pdsFor(row.did)
        return pds ? toListen(row, pds) : null
      }),
    )

    return {
      ok: true,
      recordings: mapped.filter((r): r is ListenRecording => r !== null),
      cursor: body.cursor,
    }
  } catch (error) {
    return { ok: false, reason: "exception", detail: (error as Error).message }
  }
}
