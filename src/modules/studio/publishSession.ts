import { recordingMarkdownLink } from "../atproto/publishedNotes"
import { uploadRecording } from "../atproto/uploadRecording"
import type { CuePcm, TakePcm } from "./assemble"
import { renderSessionInWorker } from "./renderInWorker"
import { speechTrack } from "./edl"
import type { MusicCredit, Session } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { contentTier, decodeTakeToMono, encodeOpus } from "./mediaCodec"
import { creditsToPublish, musicPathsInUse, programmeDurationSec } from "./musicSlots"
import { analyzeTakeFile } from "./analyzeTake"
import { readTakeFile } from "./opfsTakes"
import { readCueFile } from "./opfsCues"

// The end of the line: render whatever the EDL currently says, encode it to Opus, and
// write it to the PDS. With a `noteRkey` the deliverable is the record itself, put at the
// note's own rkey — the note gains its audio without a single byte of the note changing,
// so there is nothing to paste and `link` comes back null. Without one there is no note to
// attach to, and the deliverable falls back to the copyable markdown link the author pastes
// into a `.pub.md`. Never writes a note either way — the note goes through git via the
// existing Action.
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
  /** Music already decoded, by OPFS path — anything missing is decoded here, same as takes. */
  musicPcm?: CuePcm
  /** The rkey of the note being recorded against; the recording is written there. */
  noteRkey?: string
}

/**
 * The credit lines that ride under the markdown link. CC-BY asks for the title, the author
 * and the licence, and the note is where a reader can actually see them — a WebM blob has
 * nowhere to carry attribution, and the record's `credits` field is for machines.
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
  musicPcm = {},
  noteRkey,
}: PublishParams): Promise<PublishResult> => {
  if (programmeDurationSec(session) <= 0) {
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

  // Music is decoded to mono at the session rate, the same as takes. One decode per track,
  // however many slots play it.
  const cuePcm: CuePcm = { ...musicPcm }
  for (const path of musicPathsInUse(session)) {
    if (cuePcm[path]) continue
    const file = await readCueFile(path)
    if (!file) return { ok: false, error: "A music track could not be read back from storage." }
    const decoded = await decodeTakeToMono(file, SESSION_SAMPLE_RATE)
    if (!decoded) return { ok: false, error: "A music track could not be decoded." }
    cuePcm[path] = decoded.samples
  }

  const rendered = await renderSessionInWorker(session, pcm, SESSION_SAMPLE_RATE, cuePcm)
  if (rendered.samples.length === 0) {
    return { ok: false, error: "The render came out empty." }
  }

  const encoded = await encodeOpus(
    rendered.samples,
    SESSION_SAMPLE_RATE,
    rendered.durationSec,
    `${title || "episode"}.weba`,
    contentTier(session),
  )
  if (!encoded) return { ok: false, error: "Opus encoding failed." }

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

  return {
    ok: true,
    link: noteRkey ? null : withCredits(recordingMarkdownLink(result.uri, title), credits),
    uri: result.uri,
    durationSec: rendered.durationSec,
    measuredLufs: rendered.measuredLufs,
  }
}
