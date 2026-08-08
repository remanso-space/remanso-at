import { getActiveSession } from "vue-atproto-login"
import { parseAtUri } from "./parseAtUri"
import type { PublicNoteRecord } from "./publicNote.types"
import { RECORDING_COLLECTION } from "./recording.types"

// Read straight from your PDS with listRecords rather than the appview's endpoint, which
// hides non-discoverable notes and drops `content` — and `content` is what says which notes
// already carry audio. The studio never writes a note; it only reads this list.

export const NOTE_COLLECTION = "space.remanso.note"

// Stops at whitespace or a markdown-link close, so `![alt](at://…)` yields just the URI.
const recordingUriPattern = () =>
  new RegExp(`at://[^\\s)\\]]+/${RECORDING_COLLECTION.replace(/\./g, "\\.")}/[^\\s)\\]]+`, "gi")

export const noteRecordingUris = (content: string): string[] => {
  const found = content.match(recordingUriPattern())
  return found ? [...new Set(found)] : []
}

/** The alt text / recording title convention, matching useAudioUpload's `<title> - audio`. */
export const recordingAltFor = (title: string): string => `${title} - audio`

/**
 * The markdown the user pastes into a `.pub.md`, which the CLI republishes with the audio
 * embedded. The studio never writes the note itself — that would be a split brain against the
 * git source of truth.
 */
export const recordingMarkdownLink = (atUri: string, title: string): string =>
  `![${recordingAltFor(title)}](${atUri})`

export interface PublishedNote {
  record: PublicNoteRecord
  recordingUris: string[]
  /** A recording sits at this note's own rkey — the attached model, no content scan involved. */
  attached: boolean
  hasAudio: boolean
}

export type ListNotesResult =
  | { ok: true; notes: PublishedNote[]; cursor?: string }
  | { ok: false; reason: "no-session" | "list-failed" | "exception"; detail?: string }

interface ListNotesParams {
  did: string
  cursor?: string
  limit?: number
}

const describeFailure = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as { error?: string; message?: string }
    if (body.error) return `${res.status} ${body.error}: ${body.message ?? ""}`.trim()
  } catch {
    // no JSON body
  }
  return `HTTP ${res.status}`
}

/**
 * A recording at rkey R is the recording of the note at rkey R, so this set is how a note
 * learns it already has audio.
 *
 * The whole collection is walked, not just the first page: a missing rkey reads as "no audio
 * yet", so a truncated set would skip the replace warning. Failure returns the pages already
 * collected rather than throwing — the markers annotate the note list, and losing them is no
 * reason to leave the user with no notes to pick from.
 */
export const listRecordingRkeys = async (did: string): Promise<Set<string>> => {
  const session = await getActiveSession(did)
  if (!session) return new Set()

  const rkeys = new Set<string>()
  let cursor: string | undefined

  try {
    do {
      const query = new URLSearchParams({
        repo: did,
        collection: RECORDING_COLLECTION,
        limit: "100",
      })
      if (cursor) query.set("cursor", cursor)

      const res = await session.fetchHandler(`/xrpc/com.atproto.repo.listRecords?${query}`, {
        method: "GET",
      })
      if (!res.ok) return rkeys

      const body = (await res.json()) as { records: { uri: string }[]; cursor?: string }
      for (const record of body.records) rkeys.add(parseAtUri(record.uri).rkey)
      // A cursor with no records means the collection is exhausted; some PDS
      // implementations still hand one back, and following it would never end.
      cursor = body.records.length ? body.cursor : undefined
    } while (cursor)

    return rkeys
  } catch {
    return rkeys
  }
}

/**
 * Annotated with the audio each note carries: attached at its own rkey, or embedded in its
 * content by the legacy paste.
 */
export const listPublishedNotes = async ({
  did,
  cursor,
  limit = 50,
}: ListNotesParams): Promise<ListNotesResult> => {
  const session = await getActiveSession(did)
  if (!session) return { ok: false, reason: "no-session" }

  // No `reverse`: the PDS orders listRecords by rkey descending by default, and rkeys are
  // TIDs, so the default already reads newest first. Asking for reverse=true walks the repo
  // from its oldest note, which on a prolific author never reaches the one just published.
  const query = new URLSearchParams({
    repo: did,
    collection: NOTE_COLLECTION,
    limit: String(limit),
  })
  if (cursor) query.set("cursor", cursor)

  try {
    const res = await session.fetchHandler(`/xrpc/com.atproto.repo.listRecords?${query}`, {
      method: "GET",
    })
    if (!res.ok) return { ok: false, reason: "list-failed", detail: await describeFailure(res) }

    const body = (await res.json()) as { records: PublicNoteRecord[]; cursor?: string }
    const recordingRkeys = await listRecordingRkeys(did)
    const notes = body.records.map((record) => {
      const recordingUris = noteRecordingUris(record.value.content)
      const attached = recordingRkeys.has(parseAtUri(record.uri).rkey)
      return { record, recordingUris, attached, hasAudio: attached || recordingUris.length > 0 }
    })
    return { ok: true, notes, cursor: body.cursor }
  } catch (error) {
    return { ok: false, reason: "exception", detail: (error as Error).message }
  }
}
