import { getActiveSession } from "vue-atproto-login"
import { parseAtUri } from "./parseAtUri"
import type { PublicNoteRecord } from "./publicNote.types"
import { RECORDING_COLLECTION } from "./recording.types"

// The studio opens on your published notes so you can pick one to record against
// (plan: "the studio's deliverable is a markdown link"). The list is read straight from
// your PDS with listRecords — authoritative and complete, unlike the appview's endpoint
// which hides non-discoverable notes and drops `content`. The content is what lets us mark
// which notes already carry audio, the actual navigation surface of a podcast built this
// way. The studio never writes a note; it only reads this list.

export const NOTE_COLLECTION = "space.remanso.note"

// An embedded recording is an `at://…/space.remanso.recording/…` link in the note body
// (written by the CLI after you paste the studio's markdown). Stop at whitespace or a
// markdown-link close so `![alt](at://…)` yields just the URI.
const recordingUriPattern = () =>
  new RegExp(`at://[^\\s)\\]]+/${RECORDING_COLLECTION.replace(/\./g, "\\.")}/[^\\s)\\]]+`, "gi")

/** Every distinct recording at-uri embedded in a note's content, in first-seen order. */
export const noteRecordingUris = (content: string): string[] => {
  const found = content.match(recordingUriPattern())
  return found ? [...new Set(found)] : []
}

/** The alt text / recording title convention, matching useAudioUpload's `<title> - audio`. */
export const recordingAltFor = (title: string): string => `${title} - audio`

/**
 * The studio's entire deliverable: the markdown the user pastes into a `.pub.md`, which
 * the CLI then republishes with the audio embedded. `![<title> - audio](at://…)` — nothing
 * more. The studio never writes the note itself (that is a split-brain against the git
 * source of truth); it only hands back this string.
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
 * Every rkey the recording collection holds, which is how a note learns it already has
 * audio attached: a recording at rkey R is the recording of the note at rkey R.
 *
 * One listRecords per page for the whole repo rather than a getRecord per note. The whole
 * collection is walked, not just the first page: an rkey missing from this set reads as
 * "no audio yet", so a truncated set would skip the replace warning on exactly the notes
 * a prolific author records against most.
 *
 * An empty set on failure, never a throw: the recordings are an annotation on the note
 * list, and losing the audio markers is not a reason to leave the user with no notes to
 * pick from. A partial walk keeps the pages it already has — half the markers beat none.
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
 * List the signed-in user's published notes, newest first, each annotated with the audio
 * it carries — attached at its own rkey, or embedded in its content by the legacy paste.
 * Cursor-paginated like the PDS itself.
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
