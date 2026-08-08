import { MAX_RECORDING_BYTES } from "../atproto/recording.types"
import { clipDurationSec } from "./edl"
import type { Session } from "./edl.types"
import { cueClipsFromSlots, programmeDurationSec } from "./musicSlots"
import { downmixToMono, resampleLinear } from "./pcm"

// The browser-coupled edges of the render. WebCodecs is unavailable in jsdom, so nothing here
// is unit-tested — it is verified in the app.

const MIN_BITRATE = 32_000
const SIZE_SAFETY = 0.9

/**
 * Speech-only Opus is transparent at 64 kbps; music is broadband and asks for 128. Higher
 * bitrate means fewer minutes under the 50 MB blob ceiling.
 */
export type ContentTier = "speech" | "occasional-cue" | "music-heavy"

const PREFERRED_BITRATE: Record<ContentTier, number> = {
  speech: 64_000,
  "occasional-cue": 96_000,
  "music-heavy": 128_000,
}

/**
 * A bitrate that lands the encode under the 50 MB blob ceiling, preferring the tier's target
 * and dropping only when duration forces it.
 */
export const bitrateFor = (durationSec: number, tier: ContentTier = "speech"): number => {
  const preferred = PREFERRED_BITRATE[tier]
  if (durationSec <= 0) return preferred
  const budget = (MAX_RECORDING_BYTES * 8 * SIZE_SAFETY) / durationSec
  return Math.max(MIN_BITRATE, Math.min(preferred, Math.floor(budget)))
}

/** Minutes of audio the 50 MB ceiling allows at a tier's preferred bitrate. */
export const minutesAtTier = (tier: ContentTier): number =>
  Math.floor((MAX_RECORDING_BYTES * 8 * SIZE_SAFETY) / PREFERRED_BITRATE[tier] / 60)

/**
 * Measured on the projected clips, so a slot whose chapter anchor no longer resolves costs
 * nothing.
 */
export const contentTier = (session: Session): ContentTier => {
  const clips = cueClipsFromSlots(session)
  if (clips.length === 0) return "speech"

  const total = programmeDurationSec(session)
  const covered = clips.reduce((sum, c) => sum + clipDurationSec(c), 0)
  return total > 0 && covered / total >= 0.25 ? "music-heavy" : "occasional-cue"
}

// Lazy import so the demuxers stay off the initial bundle, narrowed to the containers a
// browser MediaRecorder actually produces plus the file-import formats.
const loadMediabunny = async () => {
  const {
    ADTS,
    AudioBufferSink,
    AudioBufferSource,
    BlobSource,
    BufferTarget,
    canEncodeAudio,
    FLAC,
    Input,
    MATROSKA,
    MP3,
    MP4,
    Output,
    OGG,
    QTFF,
    WAVE,
    WEBM,
    WebMOutputFormat,
  } = await import("mediabunny")
  return {
    AudioBufferSink,
    AudioBufferSource,
    BlobSource,
    BufferTarget,
    canEncodeAudio,
    Input,
    Output,
    WebMOutputFormat,
    formats: [MP4, QTFF, MATROSKA, WEBM, MP3, WAVE, OGG, ADTS, FLAC],
  }
}

/** The capability gate. False means the studio must refuse — there is no fallback. */
export const canEncodeOpus = async (): Promise<boolean> => {
  try {
    const { canEncodeAudio } = await loadMediabunny()
    return await canEncodeAudio("opus")
  } catch {
    return false
  }
}

export interface DecodedTake {
  samples: Float32Array
  durationSec: number
}

/** Streamed, so an hour of audio is never fully resident twice. */
export const decodeTakeToMono = async (
  file: File,
  targetRate: number,
): Promise<DecodedTake | null> => {
  const { AudioBufferSink, BlobSource, Input, formats } = await loadMediabunny()
  const input = new Input({ formats, source: new BlobSource(file) })

  const track = await input.getPrimaryAudioTrack()
  if (!track) return null

  const channels = await track.getNumberOfChannels()
  const durationSec = await track.computeDuration()

  const pieces: Float32Array[] = []
  let total = 0
  for await (const { buffer } of new AudioBufferSink(track).buffers()) {
    const chans = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
    const mono = resampleLinear(downmixToMono(chans), buffer.sampleRate, targetRate)
    pieces.push(mono)
    total += mono.length
  }

  const samples = new Float32Array(total)
  let at = 0
  for (const piece of pieces) {
    samples.set(piece, at)
    at += piece.length
  }
  return { samples, durationSec }
}

export interface EncodedRecording {
  file: File
  mimeType: string
}

/**
 * The AudioBuffer is built with its standalone constructor, so no AudioContext is created;
 * samples are fed in windows to respect encoder backpressure.
 */
export const encodeOpus = async (
  mono: Float32Array,
  sampleRate: number,
  durationSec: number,
  name = "episode.weba",
  tier: ContentTier = "speech",
): Promise<EncodedRecording | null> => {
  const { AudioBufferSource, BufferTarget, Output, WebMOutputFormat } = await loadMediabunny()

  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
  const source = new AudioBufferSource({ codec: "opus", bitrate: bitrateFor(durationSec, tier) })
  output.addAudioTrack(source)
  await output.start()

  const WINDOW = sampleRate // one second per AudioBuffer
  for (let start = 0; start < mono.length; start += WINDOW) {
    const length = Math.min(WINDOW, mono.length - start)
    const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 })
    // A fresh, ArrayBuffer-backed view; a subarray of `mono` types as ArrayBufferLike,
    // which copyToChannel rejects.
    const chunk = new Float32Array(length)
    chunk.set(mono.subarray(start, start + length))
    buffer.copyToChannel(chunk, 0)
    await source.add(buffer)
  }

  await output.finalize()
  const encoded = output.target.buffer
  if (!encoded) return null

  return { file: new File([encoded], name, { type: "audio/webm" }), mimeType: "audio/webm" }
}
