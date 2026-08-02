import { recordingMarkdownLink } from "../atproto/publishedNotes"
import { uploadRecording } from "../atproto/uploadRecording"
import { renderSession, type TakePcm } from "./assemble"
import { speechTrack, timelineDurationSec } from "./edl"
import type { Session } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { encodeOpus } from "./mediaCodec"
import { analyzeTakeFile } from "./analyzeTake"
import { readTakeFile } from "./opfsTakes"

// The end of the line: render whatever the EDL currently says, encode it to Opus,
// uploadBlob + createRecord, and hand back the copyable markdown link. Never writes a
// note — the link goes through git via the existing Action (plan: the studio's
// deliverable is a link).
//
// Slice 5 moved the editing decisions *out* of here. Pause removal used to be a boolean
// on this call; it is now clip edits the review pass has already made, so publish has no
// opinion about the audio at all beyond the chain. That is the whole point of the pause
// detector emitting edits rather than processed samples.
//
// Browser-coupled (decode/encode/upload/OPFS); the pieces it composes are each unit-tested.

export interface PublishParams {
  did: string
  session: Session
  title: string
  /** Samples already decoded by the review pass, by take id — anything missing is decoded here. */
  takePcm?: TakePcm
}

export type PublishResult =
  | { ok: true; link: string; uri: string; durationSec: number; measuredLufs: number | null }
  | { ok: false; error: string }

/** Takes the timeline still plays. A take that every edit rejected need not be decoded. */
const takeIdsInUse = (session: Session): Set<string> => {
  const ids = new Set<string>()
  for (const clip of speechTrack(session).clips) {
    if (clip.muted) continue
    if (clip.source.kind === "take") ids.add(clip.source.takeId)
  }
  return ids
}

export const publishSession = async ({
  did,
  session,
  title,
  takePcm = {},
}: PublishParams): Promise<PublishResult> => {
  if (timelineDurationSec(session) <= 0) {
    return { ok: false, error: "There is nothing to publish — every region is rejected or muted." }
  }

  const pcm: TakePcm = { ...takePcm }
  for (const takeId of takeIdsInUse(session)) {
    if (pcm[takeId]) continue
    const take = session.takes.find((t) => t.id === takeId)
    if (!take) return { ok: false, error: "A take referenced by the edit is missing." }

    const file = await readTakeFile(take.opfsPath)
    if (!file) return { ok: false, error: "A take could not be read back from storage." }
    const analyzed = await analyzeTakeFile(file, SESSION_SAMPLE_RATE)
    if (!analyzed) return { ok: false, error: "A take could not be decoded." }
    pcm[takeId] = analyzed.samples
  }

  const rendered = renderSession(session, pcm, SESSION_SAMPLE_RATE)
  if (rendered.samples.length === 0) {
    return { ok: false, error: "The render came out empty." }
  }

  const encoded = await encodeOpus(
    rendered.samples,
    SESSION_SAMPLE_RATE,
    rendered.durationSec,
    `${title || "episode"}.weba`,
  )
  if (!encoded) return { ok: false, error: "Opus encoding failed." }

  const result = await uploadRecording({
    did,
    file: encoded.file,
    title,
    durationSec: Math.round(rendered.durationSec),
    mimeType: encoded.mimeType,
  })

  if (!result.ok) {
    const detail = "detail" in result && result.detail ? `: ${result.detail}` : ""
    return { ok: false, error: `Publish failed (${result.reason}${detail}).` }
  }

  return {
    ok: true,
    link: recordingMarkdownLink(result.uri, title),
    uri: result.uri,
    durationSec: rendered.durationSec,
    measuredLufs: rendered.measuredLufs,
  }
}
