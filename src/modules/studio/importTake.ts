import type { Take } from "./edl.types"
import { writeTakeFile } from "./opfsTakes"

// An imported file is a take like any other from here on. The import does not transcode: the
// take is an intermediate the render re-encodes to Opus anyway.
//
// What can be read is exactly what mediaCodec.ts loads mediabunny with — MP4/QTFF,
// Matroska/WebM, MP3, WAVE, OGG, ADTS and FLAC.

/** Extensions of the containers mediabunny is loaded with, lowercase, no dot. */
const KNOWN_EXTENSIONS = new Set([
  "m4a",
  "m4b",
  "mp4",
  "mov",
  "mkv",
  "webm",
  "weba",
  "mp3",
  "wav",
  "wave",
  "ogg",
  "oga",
  "opus",
  "aac",
  "flac",
])

/**
 * A fallback for files whose name lost its extension (AirDrop, a share sheet, a paste). The
 * value is the extension the OPFS copy is given, not a claim about the codec inside.
 */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/aacp": "aac",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "weba",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
}

/**
 * The file picker's filter. `audio/*` alone hides .m4a on some Android pickers and .opus on
 * others, so the extensions are spelled out beside it; the picker unions the two.
 */
export const IMPORT_ACCEPT =
  "audio/*,.m4a,.m4b,.mp4,.mov,.mkv,.webm,.weba,.mp3,.wav,.ogg,.oga,.opus,.aac,.flac"

export const takeExtensionFor = (file: File): string | null => {
  const dot = file.name.lastIndexOf(".")
  const named = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ""
  if (KNOWN_EXTENSIONS.has(named)) return named
  return EXTENSION_BY_TYPE[file.type.toLowerCase()] ?? null
}

export type ImportResult = { ok: true; take: Take } | { ok: false; error: string }

/**
 * `durationSec` is left at 0 on purpose: the caller decodes next, and the sample count is the
 * only duration the EDL may index against (see analyzeTakeFile).
 */
export const importTake = async (file: File, id: string): Promise<ImportResult> => {
  const extension = takeExtensionFor(file)
  if (!extension) {
    return {
      ok: false,
      error: `“${file.name}” is not an audio file the studio can read. Try m4a, mp3, wav, ogg, flac or webm.`,
    }
  }
  if (file.size === 0) return { ok: false, error: `“${file.name}” is empty.` }

  try {
    const opfsPath = await writeTakeFile(id, file, extension)
    return {
      ok: true,
      take: { id, opfsPath, durationSec: 0, peaksPath: "", flags: [], label: file.name },
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "storage error"
    return { ok: false, error: `“${file.name}” could not be stored (${reason}).` }
  }
}
