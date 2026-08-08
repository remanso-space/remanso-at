import { recordingMarkdownLink } from "../atproto/publishedNotes"
import { uploadRecording } from "../atproto/uploadRecording"
import type { CuePcm, TakePcm } from "./assemble"
import type { MusicCredit, Session } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { contentTier, encodeOpus } from "./mediaCodec"
import { creditsToPublish, programmeDurationSec } from "./musicSlots"
import { renderToPcm, type RenderProgress } from "./renderToPcm"

// With a `noteRkey` the recording is put at the note's own rkey, so the note gains its audio
// without any byte of the note changing and `link` comes back null. Without one there is
// nothing to attach to, and the deliverable is the markdown link the author pastes into a
// `.pub.md`. Never writes a note either way — the note goes through git via the existing
// Action.
//
// Browser-coupled (decode/encode/upload/OPFS); the pieces it composes are each unit-tested.

export interface PublishParams {
  did: string
  session: Session
  title: string
  /** Samples already decoded by the review pass, by take id — anything missing is decoded here. */
  takePcm?: TakePcm
  /** Music already decoded, by OPFS path — anything missing is decoded here, same as takes. */
  musicPcm?: CuePcm
  /** The rkey of the note being recorded against; the recording is written there. */
  noteRkey?: string
  onProgress?: (progress: RenderProgress) => void
}

/**
 * CC-BY asks for the title, author and licence, and the note is the only place a reader can
 * see them: a WebM blob cannot carry attribution and the record's `credits` field is for
 * machines.
 */
const withCredits = (link: string, credits: MusicCredit[]): string => {
  if (credits.length === 0) return link
  const lines = credits.map(
    (c) => `Music: [${c.title}](${c.sourceUrl}) by ${c.creator} — [CC BY](${c.licenseUrl})`,
  )
  return `${link}\n\n${lines.join("\n")}`
}

export type PublishResult =
  | {
      ok: true
      /** The markdown to paste, or null when the recording attached itself to a note. */
      link: string | null
      uri: string
      durationSec: number
      measuredLufs: number | null
    }
  | { ok: false; error: string }

export const publishSession = async ({
  did,
  session,
  title,
  takePcm = {},
  musicPcm = {},
  noteRkey,
  onProgress,
}: PublishParams): Promise<PublishResult> => {
  if (programmeDurationSec(session) <= 0) {
    return { ok: false, error: "There is nothing to publish — every region is rejected or muted." }
  }

  // Decode-and-render owns the first three quarters of the bar, so scale the shared step's
  // fraction into that window and the bar never jumps back.
  const prepared = await renderToPcm({
    session,
    takePcm,
    musicPcm,
    onProgress: (p) => onProgress?.({ fraction: p.fraction * 0.75, label: p.label }),
  })
  if (!prepared.ok) return prepared
  const rendered = prepared.render

  onProgress?.({ fraction: 0.8, label: "Encoding to Opus…" })
  const encoded = await encodeOpus(
    rendered.samples,
    SESSION_SAMPLE_RATE,
    rendered.durationSec,
    `${title || "episode"}.weba`,
    contentTier(session),
  )
  if (!encoded) return { ok: false, error: "Opus encoding failed." }

  onProgress?.({ fraction: 0.9, label: "Uploading to your PDS…" })
  const credits = creditsToPublish(session)
  const result = await uploadRecording({
    did,
    file: encoded.file,
    title,
    durationSec: Math.round(rendered.durationSec),
    mimeType: encoded.mimeType,
    rkey: noteRkey,
    credits,
  })

  if (!result.ok) {
    const detail = "detail" in result && result.detail ? `: ${result.detail}` : ""
    return { ok: false, error: `Publish failed (${result.reason}${detail}).` }
  }

  onProgress?.({ fraction: 1, label: "Published." })
  return {
    ok: true,
    link: noteRkey ? null : withCredits(recordingMarkdownLink(result.uri, title), credits),
    uri: result.uri,
    durationSec: rendered.durationSec,
    measuredLufs: rendered.measuredLufs,
  }
}
