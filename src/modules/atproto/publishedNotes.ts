import { getActiveSession } from "./service/atprotoOAuth"
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
 * List the signed-in user's published notes, newest first, each annotated with the
 * recordings its content already embeds. Cursor-paginated like the PDS itself.
 */
export const listPublishedNotes = async ({
  did,
  cursor,
  limit = 50,
}: ListNotesParams): Promise<ListNotesResult> => {
  const session = await getActiveSession(did)
  if (!session) return { ok: false, reason: "no-session" }

  const query = new URLSearchParams({
    repo: did,
    collection: NOTE_COLLECTION,
    limit: String(limit),
    reverse: "true", // newest first
  })
  if (cursor) query.set("cursor", cursor)

  try {
    const res = await session.fetchHandler(`/xrpc/com.atproto.repo.listRecords?${query}`, {
      method: "GET",
    })
    if (!res.ok) return { ok: false, reason: "list-failed", detail: await describeFailure(res) }

    const body = (await res.json()) as { records: PublicNoteRecord[]; cursor?: string }
    const notes = body.records.map((record) => {
      const recordingUris = noteRecordingUris(record.value.content)
      return { record, recordingUris, hasAudio: recordingUris.length > 0 }
    })
    return { ok: true, notes, cursor: body.cursor }
  } catch (error) {
    return { ok: false, reason: "exception", detail: (error as Error).message }
  }
}
