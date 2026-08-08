import { analyzeTakeFile } from "./analyzeTake"
import type { CuePcm, SessionRender, TakePcm } from "./assemble"
import { speechTrack } from "./edl"
import type { Session } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { decodeTakeToMono } from "./mediaCodec"
import { musicPathsInUse, programmeDurationSec } from "./musicSlots"
import { readCueFile } from "./opfsCues"
import { readTakeFile } from "./opfsTakes"
import { renderSessionInWorker } from "./renderInWorker"

// Decode and render, without the encode or upload, so the preview and the publish run the
// exact same assembly.

export interface RenderProgress {
  fraction: number
  label: string
}

export type RenderToPcmResult = { ok: true; render: SessionRender } | { ok: false; error: string }

export interface RenderToPcmParams {
  session: Session
  /** Samples already decoded by the review pass, by take id — anything missing is decoded here. */
  takePcm?: TakePcm
  /** Music already decoded, by OPFS path — anything missing is decoded here, same as takes. */
  musicPcm?: CuePcm
  onProgress?: (progress: RenderProgress) => void
}

/** A take that every edit rejected need not be decoded. */
const takeIdsInUse = (session: Session): Set<string> => {
  const ids = new Set<string>()
  for (const clip of speechTrack(session).clips) {
    if (clip.muted) continue
    if (clip.source.kind === "take") ids.add(clip.source.takeId)
  }
  return ids
}

/** Decodes whatever the EDL still references, then renders off the main thread. */
export const renderToPcm = async ({
  session,
  takePcm = {},
  musicPcm = {},
  onProgress,
}: RenderToPcmParams): Promise<RenderToPcmResult> => {
  if (programmeDurationSec(session) <= 0) {
    return { ok: false, error: "There is nothing to render — every region is rejected or muted." }
  }

  const takeIds = [...takeIdsInUse(session)]
  const musicPaths = [...musicPathsInUse(session)]
  // Decode owns most of the bar; a floor of one step keeps the maths from dividing by zero.
  const decodeSteps = Math.max(1, takeIds.length + musicPaths.length)
  let done = 0
  const report = (label: string) => onProgress?.({ fraction: (done / decodeSteps) * 0.8, label })

  const pcm: TakePcm = { ...takePcm }
  for (const takeId of takeIds) {
    report("Decoding takes…")
    if (!pcm[takeId]) {
      const take = session.takes.find((t) => t.id === takeId)
      if (!take) return { ok: false, error: "A take referenced by the edit is missing." }
      const file = await readTakeFile(take.opfsPath)
      if (!file) return { ok: false, error: "A take could not be read back from storage." }
      const analyzed = await analyzeTakeFile(file, SESSION_SAMPLE_RATE)
      if (!analyzed) return { ok: false, error: "A take could not be decoded." }
      pcm[takeId] = analyzed.samples
    }
    done += 1
  }

  const cuePcm: CuePcm = { ...musicPcm }
  for (const path of musicPaths) {
    report("Decoding music…")
    if (!cuePcm[path]) {
      const file = await readCueFile(path)
      if (!file) return { ok: false, error: "A music track could not be read back from storage." }
      const decoded = await decodeTakeToMono(file, SESSION_SAMPLE_RATE)
      if (!decoded) return { ok: false, error: "A music track could not be decoded." }
      cuePcm[path] = decoded.samples
    }
    done += 1
  }

  onProgress?.({ fraction: 0.85, label: "Rendering the programme…" })
  const render = await renderSessionInWorker(session, pcm, SESSION_SAMPLE_RATE, cuePcm)
  if (render.samples.length === 0) {
    return { ok: false, error: "The render came out empty." }
  }
  onProgress?.({ fraction: 1, label: "Done." })
  return { ok: true, render }
}
