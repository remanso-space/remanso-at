// Importing a music/sound file as a cue (slice 6). The MIME resolution is lifted verbatim
// from remanso.space's useAudioUpload.hook.ts — same Android Storage Access Framework
// workaround: a file picked out of Downloads on Android often arrives with an empty or
// generic MIME, so a container is recognised by extension when the browser gives us nothing
// usable. Kept identical on purpose, so the two apps accept exactly the same files.

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  aac: "audio/aac",
  amr: "audio/amr",
  awb: "audio/amr-wb",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
}

/**
 * Settle on a MIME type for an imported cue. Android's SAF reports an empty or generic MIME
 * for several audio containers; fall back to the extension. Returns null when the file is
 * not audio by either signal.
 */
export const audioMimeType = (file: File): string | null => {
  if (file.type.startsWith("audio/")) return file.type
  if (file.type && file.type !== "application/octet-stream") return null

  const extension = file.name.split(".").pop()?.toLowerCase() ?? ""
  return AUDIO_MIME_BY_EXTENSION[extension] ?? null
}

/** The file extension to store a cue under, from its name or (as a fallback) its MIME. */
export const cueExtension = (file: File): string => {
  const fromName = file.name.split(".").pop()?.toLowerCase()
  if (fromName && fromName !== file.name.toLowerCase()) return fromName
  const mime = audioMimeType(file)
  const match = mime && Object.entries(AUDIO_MIME_BY_EXTENSION).find(([, m]) => m === mime)
  return match ? match[0] : "bin"
}
