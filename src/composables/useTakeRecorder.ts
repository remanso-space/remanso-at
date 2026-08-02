import { onScopeDispose, readonly, ref, shallowRef } from "vue"

import type { Marker, Take } from "../modules/studio/edl.types"
import { SESSION_SAMPLE_RATE } from "../modules/studio/edl.types"
import { createTakeWriter, type TakeWriter } from "../modules/studio/opfsTakes"
import { useRecordingState } from "./useRecordingState"

/**
 * Ordered by playback reach, not encoder quality. Safari below 18.4 cannot play WebM/Opus,
 * so an MP4/AAC take plays on every browser — take it whenever the recorder can produce it.
 * Firefox only offers WebM or Ogg and lands further down. (Kept verbatim from remanso.)
 */
const MIME_CANDIDATES = [
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
]

const EXTENSION_BY_CONTAINER: Record<string, string> = {
  mp4: "m4a",
  webm: "weba",
  ogg: "ogg",
}

// The take is an intermediate now, re-encoded at render, so capture at a higher rate than
// remanso's 48k deliverable — headroom for the chain to work with (plan: capture changes).
const AUDIO_BITS_PER_SECOND = 96_000

const MIC_STORAGE_KEY = "remanso:studio:mic"
const LEVEL_BARS = 32

const supportedMime = (): string | null => {
  if (typeof MediaRecorder === "undefined") return null
  if (typeof MediaRecorder.isTypeSupported !== "function") return null
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

const extensionFor = (mimeType: string): string => {
  const container = mimeType.split(";")[0]?.split("/")[1] ?? "webm"
  return EXTENSION_BY_CONTAINER[container] ?? container
}

const makeId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return `take-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export const useTakeRecorder = () => {
  const { setRecording } = useRecordingState()

  const devices = ref<MediaDeviceInfo[]>([])
  const deviceId = ref(localStorage.getItem(MIC_STORAGE_KEY) ?? "")
  const isRecording = ref(false)
  const elapsedSec = ref(0)
  const levels = ref<number[]>(Array.from({ length: LEVEL_BARS }, () => 0))
  const flags = ref<Marker[]>([])
  const error = ref<string | null>(null)

  const recorder = shallowRef<MediaRecorder | null>(null)
  let stream: MediaStream | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let writer: TakeWriter | null = null
  let startedAt = 0
  let raf = 0
  let takeId = ""

  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    event.preventDefault()
    event.returnValue = ""
  }

  // Two flags, two keys, no timing. The plan proposed one button with tap = mark and
  // double-tap = retake; the double-tap loses. It cannot resolve a tap until the window
  // expires, so the mark you feel you placed lands late, and a second tap that misses the
  // window silently becomes two marks — in the one moment of the session where you have
  // no attention to spare for checking. Two targets cost one more button and are
  // unambiguous at any speed. F marks, R condemns the line just said.
  const onFlagKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
    const target = event.target as HTMLElement | null
    if (target?.isContentEditable) return
    if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return

    const key = event.key.toLowerCase()
    if (key !== "f" && key !== "r") return
    event.preventDefault()
    flag(key === "f" ? "mark" : "retake")
  }

  const tick = () => {
    elapsedSec.value = (performance.now() - startedAt) / 1000
    if (analyser) {
      const buf = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const centred = (v - 128) / 128
        sum += centred * centred
      }
      const rms = Math.sqrt(sum / buf.length)
      levels.value = [...levels.value.slice(1), Math.min(1, rms * 3)]
    }
    raf = requestAnimationFrame(tick)
  }

  const openStream = async (): Promise<MediaStream> => {
    const constraint: MediaTrackConstraints | true = deviceId.value
      ? { deviceId: { exact: deviceId.value } }
      : true
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: constraint })
    } catch (err) {
      const name = (err as Error)?.name
      // A stale saved device that has since unplugged: fall back to the default mic
      // rather than dead-ending. Anything else (NotFound, insecure context) is fatal.
      if (deviceId.value && (name === "OverconstrainedError" || name === "NotFoundError")) {
        return navigator.mediaDevices.getUserMedia({ audio: true })
      }
      throw err
    }
  }

  const refreshDevices = async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices()
      devices.value = all.filter((d) => d.kind === "audioinput")
      // Drop a saved selection whose device is gone.
      if (deviceId.value && !devices.value.some((d) => d.deviceId === deviceId.value)) {
        selectDevice("")
      }
    } catch {
      devices.value = []
    }
  }

  const selectDevice = (id: string) => {
    deviceId.value = id
    if (id) localStorage.setItem(MIC_STORAGE_KEY, id)
    else localStorage.removeItem(MIC_STORAGE_KEY)
  }

  const start = async (): Promise<boolean> => {
    error.value = null
    const type = supportedMime()
    if (!type) {
      error.value = "This browser cannot record audio (no MediaRecorder MIME supported)."
      return false
    }

    try {
      stream = await openStream()
    } catch (err) {
      error.value = `Microphone unavailable: ${(err as Error)?.name ?? "error"}`
      return false
    }

    // Pinned to 48 kHz so the renderer, loudness and mixdown never branch on 44.1.
    audioContext =
      typeof AudioContext !== "undefined"
        ? new AudioContext({ sampleRate: SESSION_SAMPLE_RATE })
        : null
    if (audioContext) {
      if (audioContext.state === "suspended") await audioContext.resume()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      audioContext.createMediaStreamSource(stream).connect(analyser)
    }

    takeId = makeId()
    try {
      writer = await createTakeWriter(takeId, extensionFor(type))
    } catch (err) {
      error.value = `Storage unavailable: ${(err as Error)?.message ?? "OPFS error"}`
      await teardown()
      return false
    }

    try {
      recorder.value = new MediaRecorder(stream, {
        mimeType: type,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
    } catch (err) {
      error.value = `Recorder rejected ${type}: ${(err as Error)?.message ?? ""}`
      await teardown()
      return false
    }

    // Stream each chunk straight to OPFS instead of buffering it in memory.
    recorder.value.ondataavailable = (event) => {
      if (event.data.size && writer) void writer.write(event.data)
    }

    flags.value = []
    elapsedSec.value = 0
    startedAt = performance.now()
    recorder.value.start(1000) // a chunk per second
    isRecording.value = true
    setRecording(true)
    window.addEventListener("beforeunload", onBeforeUnload)
    window.addEventListener("keydown", onFlagKey)
    raf = requestAnimationFrame(tick)
    return true
  }

  /** F = mark this spot, R = that line was bad. Appended at take time, never timeline time. */
  const flag = (kind: Marker["kind"] = "mark") => {
    if (!isRecording.value) return
    flags.value = [...flags.value, { atTakeSec: elapsedSec.value, kind }]
  }

  const stop = async (): Promise<Take | null> => {
    const rec = recorder.value
    if (!rec || !writer) return null
    const durationSec = (performance.now() - startedAt) / 1000

    const stopped = new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
    })
    rec.stop()
    await stopped
    await writer.close()

    const take: Take = {
      id: takeId,
      opfsPath: writer.path,
      durationSec,
      peaksPath: "",
      flags: flags.value,
      label: new Date().toISOString(),
    }
    await teardown()
    return take
  }

  const cancel = async () => {
    const rec = recorder.value
    if (rec && rec.state !== "inactive") {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve()
        rec.stop()
      })
    }
    if (writer) await writer.abort()
    await teardown()
  }

  const teardown = async () => {
    cancelAnimationFrame(raf)
    window.removeEventListener("beforeunload", onBeforeUnload)
    window.removeEventListener("keydown", onFlagKey)
    stream?.getTracks().forEach((t) => t.stop())
    if (audioContext) await audioContext.close().catch(() => {})
    stream = null
    audioContext = null
    analyser = null
    writer = null
    recorder.value = null
    isRecording.value = false
    setRecording(false)
    levels.value = Array.from({ length: LEVEL_BARS }, () => 0)
  }

  onScopeDispose(() => {
    void cancel()
  })

  return {
    devices: readonly(devices),
    deviceId: readonly(deviceId),
    isRecording: readonly(isRecording),
    elapsedSec: readonly(elapsedSec),
    levels: readonly(levels),
    flags: readonly(flags),
    error: readonly(error),
    refreshDevices,
    selectDevice,
    start,
    flag,
    stop,
    cancel,
  }
}
