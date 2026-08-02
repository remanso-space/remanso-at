import { parseAtUri } from "./parseAtUri"
import { blobUrl, resolveActor, type ResolvedActor } from "./resolveActor"
import { NOTE_COLLECTION } from "./publishedNotes"
import { RECORDING_COLLECTION, type Recording } from "./recording.types"
import { toShortDid } from "./shortDid"

// /listen reads recordings straight off the PDS with listRecords — public and
// unauthenticated, so a shared link plays for a reader who has no account and the author
// sees their own cuts the moment the studio publishes them, with no appview in between.

const PAGE_LIMIT = 100
/** Enough note pages to name the recordings on any plausible repo without walking forever. */
const MAX_NOTE_PAGES = 10

export interface ListenRecording {
  uri: string
  rkey: string
  value: Recording
  /** Direct playback URL — the blob on the author's own PDS. */
  audioUrl: string
  /** The note this recording is attached to, when a note sits at the same rkey. */
  note: { title: string; url: string } | null
}

export type ListRecordingsResult =
  | { ok: true; actor: ResolvedActor; recordings: ListenRecording[]; cursor?: string }
  | { ok: false; reason: "unresolved-actor" | "list-failed" | "exception"; detail?: string }

const describeFailure = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as { error?: string; message?: string }
    if (body.error) return `${res.status} ${body.error}: ${body.message ?? ""}`.trim()
  } catch {
    // no JSON body
  }
  return `HTTP ${res.status}`
}

const listRecordsUrl = (pds: string, did: string, collection: string, cursor?: string): string => {
  const query = new URLSearchParams({ repo: did, collection, limit: String(PAGE_LIMIT) })
  if (cursor) query.set("cursor", cursor)
  // No `reverse`: listRecords orders by rkey descending by default, and rkeys are TIDs,
  // so the default *is* newest first. Passing reverse=true would hand back the oldest.
  return `${pds}/xrpc/com.atproto.repo.listRecords?${query}`
}

// remanso.space routes a public note at /pub/:shortDid/:rkey/:slug? — the slug is
// decorative, so the two-segment form lands on the note.
const noteUrl = (did: string, rkey: string) =>
  `https://remanso.space/pub/${toShortDid(did)}/${rkey}`

/**
 * rkey → note title across the repo. A recording at rkey R is the recording of the note at
 * rkey R, so this is the only thing that turns a bare recording into "the audio of this
 * episode". An empty map on failure: the titles are an annotation, and losing them is no
 * reason to withhold the audio.
 */
export const listNoteTitles = async (pds: string, did: string): Promise<Map<string, string>> => {
  const titles = new Map<string, string>()
  let cursor: string | undefined
  let pages = 0

  try {
    do {
      const res = await fetch(listRecordsUrl(pds, did, NOTE_COLLECTION, cursor))
      if (!res.ok) return titles

      const body = (await res.json()) as {
        records: { uri: string; value: { title?: string } }[]
        cursor?: string
      }
      for (const record of body.records) {
        titles.set(parseAtUri(record.uri).rkey, record.value.title ?? "")
      }
      // A cursor with no records means the collection is exhausted; some PDS
      // implementations still hand one back, and following it would never end.
      cursor = body.records.length ? body.cursor : undefined
    } while (cursor && ++pages < MAX_NOTE_PAGES)

    return titles
  } catch {
    return titles
  }
}

/**
 * One page of an author's recordings, newest first, each with a playable URL and the note
 * it belongs to. `actor` is a DID or a handle.
 */
export const listRecordings = async ({
  actor,
  cursor,
}: {
  actor: string
  cursor?: string
}): Promise<ListRecordingsResult> => {
  const resolved = await resolveActor(actor)
  if (!resolved) return { ok: false, reason: "unresolved-actor" }
  const { did, pds } = resolved

  try {
    const res = await fetch(listRecordsUrl(pds, did, RECORDING_COLLECTION, cursor))
    if (!res.ok) return { ok: false, reason: "list-failed", detail: await describeFailure(res) }

    const body = (await res.json()) as {
      records: { uri: string; value: Recording }[]
      cursor?: string
    }
    const titles = await listNoteTitles(pds, did)

    const recordings = body.records.map(({ uri, value }) => {
      const rkey = parseAtUri(uri).rkey
      const title = titles.get(rkey)
      return {
        uri,
        rkey,
        value,
        audioUrl: blobUrl({ pds, did, cid: value.audio.ref.$link }),
        note:
          title === undefined ? null : { title: title || "Untitled note", url: noteUrl(did, rkey) },
      }
    })

    return { ok: true, actor: resolved, recordings, cursor: body.cursor }
  } catch (error) {
    return { ok: false, reason: "exception", detail: (error as Error).message }
  }
}
