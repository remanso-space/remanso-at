import { recordingMarkdownLink } from "../atproto/publishedNotes"
import { uploadRecording } from "../atproto/uploadRecording"
import { renderSession, type TakePcm } from "./assemble"
import { newSession } from "./edl"
import type { Clip, Session, Take } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { decodeTakeToMono, encodeOpus } from "./mediaCodec"
import { readTakeFile } from "./opfsTakes"
import { detectSilences, keptRegions, planCuts } from "./pauses"

// The end-to-end publish: read the take from OPFS, decode it, build the EDL (optionally with
// head/tail + pause cuts applied as clip edits), render through the chain, encode to Opus,
// uploadBlob + createRecord, and hand back the copyable markdown link. Never writes a note —
// the link goes through git via the CLI (plan: the studio's deliverable is a link).
//
// Browser-coupled (decode/encode/upload/OPFS); the pieces it composes are each unit-tested.

const clipFor = (takeId: string, inSec: number, outSec: number, atSec: number): Clip => ({
  id: `${takeId}:${inSec.toFixed(3)}`,
  source: { kind: "take", takeId },
  inSec,
  outSec,
  atSec,
  gainDb: 0,
  fadeInSec: 0,
  fadeOutSec: 0,
  duck: "none",
})

/** Replace the speech track with one clip per kept region, placed contiguously (ripple). */
const sessionWithRegions = (
  base: Session,
  take: Take,
  regions: { inSec: number; outSec: number }[],
): Session => {
  let at = 0
  const clips = regions.map((r) => {
    const clip = clipFor(take.id, r.inSec, r.outSec, at)
    at += r.outSec - r.inSec
    return clip
  })
  return {
    ...base,
    tracks: base.tracks.map((t) => (t.kind === "speech" ? { ...t, clips } : t)),
  }
}

export interface PublishParams {
  did: string
  take: Take
  title: string
  removePauses: boolean
}

export type PublishResult =
  | { ok: true; link: string; uri: string; durationSec: number; measuredLufs: number | null }
  | { ok: false; error: string }

export const publishTake = async ({
  did,
  take,
  title,
  removePauses,
}: PublishParams): Promise<PublishResult> => {
  const file = await readTakeFile(take.opfsPath)
  if (!file) return { ok: false, error: "The take could not be read back from storage." }

  const decoded = await decodeTakeToMono(file, SESSION_SAMPLE_RATE)
  if (!decoded) return { ok: false, error: "The take could not be decoded." }

  let regions = [{ inSec: 0, outSec: decoded.durationSec }]
  if (removePauses) {
    const cuts = planCuts(detectSilences(decoded.samples, SESSION_SAMPLE_RATE))
    const proposed = keptRegions(decoded.durationSec, cuts)
    // Never publish nothing: if the detector would remove everything, keep the whole take.
    if (proposed.length > 0) regions = proposed
  }

  // Register the take (for the assembler's source lookup) and set the region clips directly.
  const base: Session = { ...newSession(take.id, title), takes: [take] }
  const session = sessionWithRegions(base, take, regions)

  const pcm: TakePcm = { [take.id]: decoded.samples }
  const rendered = renderSession(session, pcm, SESSION_SAMPLE_RATE)

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
