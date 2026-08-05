<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue"

import type { KeptClipRange } from "../../modules/studio/derush"
import type { Marker } from "../../modules/studio/edl.types"
import type { Cut } from "../../modules/studio/pauses"
import { peaksForColumns, type Peaks } from "../../modules/studio/peaks"

// The take, drawn once per frame that matters: precomputed peaks as the body, and every
// analysis the derush pass has to offer laid over it — what the EDL still keeps, what it
// has removed, the pause candidates, the speech onsets, the live flags, the in/out region
// and the playhead.
//
// Everything here is in *take* seconds. The timeline moves under every edit; the take
// does not, so a flag stamped at capture and a cut proposed after it always line up.

const props = defineProps<{
  peaks: Peaks | null
  durationSec: number
  kept: KeptClipRange[]
  flags: Marker[]
  cuts: Cut[]
  onsets: number[]
  playheadSec: number
  inSec: number | null
  outSec: number | null
}>()

const emit = defineEmits<{
  seek: [sec: number]
  region: [inSec: number, outSec: number]
}>()

const HEIGHT = 116
const FLAG_LANE = 12
const CUT_LANE = 8

const canvas = ref<HTMLCanvasElement | null>(null)
const probe = ref<HTMLSpanElement | null>(null)
const width = ref(0)

// CSS custom properties here are color-mix() expressions, which not every canvas
// implementation parses. Resolving them through a probe element's computed `color` hands
// back a plain rgb() every browser accepts.
const resolve = (variable: string, fallback: string): string => {
  const el = probe.value
  if (!el) return fallback
  el.style.color = `var(${variable})`
  return getComputedStyle(el).color || fallback
}

const secToX = (sec: number): number =>
  props.durationSec > 0 ? (sec / props.durationSec) * width.value : 0

const xToSec = (x: number): number =>
  width.value > 0
    ? Math.max(0, Math.min(props.durationSec, (x / width.value) * props.durationSec))
    : 0

const isKept = (sec: number): boolean =>
  props.kept.some((r) => !r.muted && sec >= r.inSec && sec < r.outSec)

const draw = () => {
  const el = canvas.value
  if (!el || width.value === 0) return
  const ctx = el.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  el.width = Math.round(width.value * dpr)
  el.height = Math.round(HEIGHT * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const ink = resolve("--hw-ink-faint", "#8a8580")
  const rule = resolve("--hw-rule", "#e5e0da")
  const accent = resolve("--link-accent", "#b0446f")
  const pink = resolve("--hw-pink", "#e36598")
  const wash = resolve("--hw-pink-wash-2", "#f6dfe7")
  const leaf = resolve("--hw-leaf", "#6b8e4e")
  const surface = resolve("--hw-surface", "#ffffff")

  ctx.clearRect(0, 0, width.value, HEIGHT)
  ctx.fillStyle = surface
  ctx.fillRect(0, 0, width.value, HEIGHT)

  const top = FLAG_LANE
  const bottom = HEIGHT - CUT_LANE
  const mid = (top + bottom) / 2
  const half = (bottom - top) / 2

  // The in/out region, under everything, so the waveform stays readable inside it.
  if (props.inSec !== null && props.outSec !== null && props.outSec > props.inSec) {
    ctx.fillStyle = wash
    ctx.fillRect(secToX(props.inSec), top, secToX(props.outSec) - secToX(props.inSec), bottom - top)
  }

  // The body. A column the EDL has removed is drawn faint rather than hidden — you need
  // to see what you cut to be able to put it back.
  const columns = peaksForColumns(
    props.peaks ?? { binsPerSec: 100, bins: new Uint8Array(0) },
    props.durationSec,
    Math.max(1, Math.floor(width.value)),
  )
  for (let x = 0; x < columns.length; x += 1) {
    const amplitude = Math.max(0.005, columns[x]) * half
    ctx.fillStyle = isKept(xToSec(x + 0.5)) ? accent : rule
    ctx.fillRect(x, mid - amplitude, 1, amplitude * 2)
  }

  // Pause candidates, in their own lane at the foot: proposals, never applied silently.
  ctx.fillStyle = leaf
  ctx.globalAlpha = 0.55
  for (const cut of props.cuts) {
    const x = secToX(cut.startSec)
    ctx.fillRect(x, bottom + 2, Math.max(1, secToX(cut.endSec) - x), CUT_LANE - 3)
  }
  ctx.globalAlpha = 1

  // Speech onsets — where a line begins, and what a rejected region should snap to.
  ctx.fillStyle = ink
  ctx.globalAlpha = 0.35
  for (const onset of props.onsets) ctx.fillRect(secToX(onset), mid - 3, 1, 6)
  ctx.globalAlpha = 1

  // Flags, in the lane above: a mark is a tick, a retake is a full-height stem.
  for (const flag of props.flags) {
    const x = secToX(flag.atTakeSec)
    ctx.fillStyle = flag.kind === "retake" ? pink : ink
    ctx.fillRect(x, 0, 1.5, flag.kind === "retake" ? HEIGHT : FLAG_LANE)
  }

  // In and out handles.
  ctx.fillStyle = accent
  if (props.inSec !== null) ctx.fillRect(secToX(props.inSec) - 1, top, 2, bottom - top)
  if (props.outSec !== null) ctx.fillRect(secToX(props.outSec) - 1, top, 2, bottom - top)

  // The playhead, last, over everything.
  ctx.fillStyle = pink
  ctx.fillRect(secToX(props.playheadSec), 0, 1.5, HEIGHT)
}

let dragFrom: { sec: number; x: number } | null = null

const secAt = (event: MouseEvent): number => {
  const rect = canvas.value?.getBoundingClientRect()
  return rect ? xToSec(event.clientX - rect.left) : 0
}

const onDown = (event: MouseEvent) => {
  dragFrom = { sec: secAt(event), x: event.clientX }
}

const onUp = (event: MouseEvent) => {
  if (dragFrom === null) return
  const to = secAt(event)
  // A drag sets the region; a click is a seek. Slop is measured in pixels, not take-seconds:
  // xToSec scales by duration, so a seconds threshold shrinks to sub-pixel on a long take and
  // every click reads as a region — the playhead could never be placed by clicking. 4 px.
  if (Math.abs(event.clientX - dragFrom.x) > 4)
    emit("region", Math.min(dragFrom.sec, to), Math.max(dragFrom.sec, to))
  else emit("seek", to)
  dragFrom = null
}

let observer: ResizeObserver | null = null

onMounted(() => {
  const el = canvas.value
  if (!el) return
  observer = new ResizeObserver(() => {
    width.value = el.clientWidth
    draw()
  })
  observer.observe(el)
  width.value = el.clientWidth
  draw()
})

onBeforeUnmount(() => observer?.disconnect())

// Shallow on purpose. The playhead moves every frame, and a deep watcher would walk the
// take's peaks — tens of thousands of entries — sixty times a second to discover that
// nothing in them changed. Every other input is replaced wholesale when it changes, so
// identity is enough.
watch(() => props.playheadSec, draw)
watch(
  () => [
    props.peaks,
    props.durationSec,
    props.kept,
    props.flags,
    props.cuts,
    props.onsets,
    props.inSec,
    props.outSec,
  ],
  draw,
)
</script>

<template>
  <div class="waveform">
    <span ref="probe" class="probe" aria-hidden="true" />
    <canvas
      ref="canvas"
      class="canvas"
      :style="{ height: `${HEIGHT}px` }"
      role="img"
      aria-label="Take waveform with flags, pause candidates and speech onsets"
      @mousedown="onDown"
      @mouseup="onUp"
      @mouseleave="dragFrom = null"
    />
  </div>
</template>

<style scoped>
.waveform {
  position: relative;
}
.canvas {
  display: block;
  width: 100%;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  cursor: crosshair;
}
.probe {
  position: absolute;
  width: 0;
  height: 0;
}
</style>
