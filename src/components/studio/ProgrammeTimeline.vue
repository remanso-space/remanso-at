<script setup lang="ts">
import { computed, ref } from "vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { projectChapterToTimeline, speechDurationSec } from "../../modules/studio/edl"
import type { Session, SlotKind } from "../../modules/studio/edl.types"
import {
  addSlot,
  newSlot,
  programmeDurationSec,
  removeSlot,
  resolveAnchorSec,
  updateSlot,
} from "../../modules/studio/musicSlots"
import { snapPoints, snapToNearest } from "../../modules/studio/snap"
import { formatDuration } from "../../utils/formatDuration"

// The programme at a glance: one clean bar spanning the whole cut, with chapters as ticks
// and the intro/break/outro music slots as blocks where they land. It exists to place breaks
// spatially — click the bar to drop a break at that second, drag a block to move it — instead
// of picking an abstract anchor from the music panel's dropdown. Every gesture writes one
// slot field through musicSlots.ts and leaves as an `edit`, so this holds no editing state
// beyond the in-flight drag.

const props = defineProps<{
  session: Session
  analyses: Record<string, TakeAnalysis>
}>()

const emit = defineEmits<{ edit: [session: Session] }>()

let counter = 0
const nextId = () => `slot-${Date.now()}-${(counter += 1)}`

const speechEnd = computed(() => speechDurationSec(props.session))
// The axis: the whole rendered length, so an outro running past the last word still fits.
const total = computed(() => Math.max(programmeDurationSec(props.session), speechEnd.value))

const chapterMarks = computed(() =>
  props.session.chapters
    .map((chapter, index) => ({ index, atSec: projectChapterToTimeline(props.session, chapter) }))
    .filter((c): c is { index: number; atSec: number } => c.atSec !== null),
)

interface SlotBlock {
  id: string
  kind: SlotKind
  atSec: number
  lengthSec: number
}

const slotBlocks = computed<SlotBlock[]>(() =>
  props.session.musicSlots
    .map((slot) => {
      const atSec = resolveAnchorSec(props.session, slot)
      return atSec === null ? null : { id: slot.id, kind: slot.kind, atSec, lengthSec: slot.lengthSec }
    })
    .filter((s): s is SlotBlock => s !== null),
)

const points = computed(() => snapPoints(props.session, props.analyses))

// Two evenly spaced gridlines, purely to give the eye a scale without clutter.
const gridPct = ["33.33%", "66.66%"]

// ── geometry ──────────────────────────────────────────────────────────────────────────

const track = ref<HTMLElement | null>(null)

const pct = (sec: number): string => (total.value > 0 ? `${(sec / total.value) * 100}%` : "0%")
// Blocks never shrink below a thumb-width, so a 4 s break on a 40 min cut stays clickable.
const blockWidth = (lengthSec: number): string =>
  total.value > 0 ? `max(0.5rem, ${(lengthSec / total.value) * 100}%)` : "0.5rem"

const rectSecAt = (clientX: number): number => {
  const rect = track.value?.getBoundingClientRect()
  if (!rect || rect.width <= 0 || total.value <= 0) return 0
  return Math.max(0, Math.min(total.value, ((clientX - rect.left) / rect.width) * total.value))
}

// Snap tolerance is a fixed pixel reach converted to seconds, so it feels the same at every
// zoom and on every cut length.
const snapSec = (sec: number): number => {
  const rect = track.value?.getBoundingClientRect()
  const tol = rect && rect.width > 0 ? (7 / rect.width) * total.value : 0.1
  return snapToNearest(sec, points.value, tol).atSec
}

const blockAtSec = (block: SlotBlock): number =>
  dragging.value?.slotId === block.id ? dragging.value.atSec : block.atSec

// A slot is hit if the second is within its span, padded by the snap reach so a thin block is
// still grabbable.
const slotHit = (sec: number): SlotBlock | undefined => {
  const rect = track.value?.getBoundingClientRect()
  const pad = rect && rect.width > 0 ? (7 / rect.width) * total.value : 0.1
  return slotBlocks.value.find((s) => sec >= s.atSec - pad && sec <= s.atSec + s.lengthSec + pad)
}

// ── gestures ──────────────────────────────────────────────────────────────────────────

const dragging = ref<{ slotId: string; atSec: number } | null>(null)
let active = false
let downClientX = 0
let downSec = 0
let downOnSlot = false
let grabOffset = 0
let moved = false

const onDown = (event: PointerEvent) => {
  if (total.value <= 0) return
  const sec = rectSecAt(event.clientX)
  const hit = slotHit(sec)
  active = true
  moved = false
  downClientX = event.clientX
  if (hit) {
    downOnSlot = true
    grabOffset = sec - hit.atSec
    dragging.value = { slotId: hit.id, atSec: hit.atSec }
  } else {
    downOnSlot = false
    downSec = sec
  }
  track.value?.setPointerCapture(event.pointerId)
}

const onMove = (event: PointerEvent) => {
  if (!active) return
  if (Math.abs(event.clientX - downClientX) > 4) moved = true
  if (dragging.value) {
    const start = snapSec(Math.max(0, rectSecAt(event.clientX) - grabOffset))
    dragging.value = { slotId: dragging.value.slotId, atSec: start }
  }
}

const onUp = (event: PointerEvent) => {
  if (!active) return
  active = false
  track.value?.releasePointerCapture(event.pointerId)

  if (dragging.value) {
    // Dragging anchors the slot absolutely — the author has said "here", not "wherever this
    // chapter ends up". Re-pin it to the second under the pointer.
    emit(
      "edit",
      updateSlot(props.session, dragging.value.slotId, {
        anchor: { kind: "absolute", atSec: dragging.value.atSec },
      }),
    )
    dragging.value = null
    return
  }
  // A click on open bar drops a break there. Only a click, never the tail of a stray drag.
  if (!downOnSlot && !moved) addBreakAt(snapSec(downSec))
}

const onCancel = () => {
  active = false
  dragging.value = null
}

const addBreakAt = (atSec: number) => {
  const slot = { ...newSlot("break", nextId()), anchor: { kind: "absolute" as const, atSec } }
  emit("edit", addSlot(props.session, slot))
}

const onRemove = (slotId: string) => emit("edit", removeSlot(props.session, slotId))
</script>

<template>
  <div class="timeline-panel">
    <div class="head">
      <p class="hw-label">§ — programme</p>
      <p class="dur mono">{{ formatDuration(total) ?? "0:00" }}</p>
    </div>

    <div
      ref="track"
      class="track"
      role="group"
      aria-label="Programme timeline — click to drop a break, drag a marker to move it"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onCancel"
    >
      <div class="speech" :style="{ width: pct(speechEnd) }" />

      <span v-for="(left, i) in gridPct" :key="'g' + i" class="grid" :style="{ left }" />

      <span
        v-for="c in chapterMarks"
        :key="'ch' + c.index"
        class="chapter"
        :style="{ left: pct(c.atSec) }"
        :title="`chapter ${c.index + 1}`"
      />

      <div
        v-for="s in slotBlocks"
        :key="s.id"
        class="slot"
        :class="[s.kind, { dragging: dragging?.slotId === s.id }]"
        :style="{ left: pct(blockAtSec(s)), width: blockWidth(s.lengthSec) }"
        :title="`${s.kind} · ${formatDuration(blockAtSec(s)) ?? '0:00'}`"
      >
        <span class="tag mono">{{ s.kind }}</span>
        <button
          class="x"
          :aria-label="`Remove ${s.kind}`"
          @pointerdown.stop
          @click.stop="onRemove(s.id)"
        >
          ×
        </button>
      </div>

      <span class="edge start mono">0:00</span>
      <span class="edge end mono">{{ formatDuration(total) ?? "0:00" }}</span>
    </div>

    <p class="hint mono">Click the bar to drop a break · drag a block to move it</p>
  </div>
</template>

<style scoped>
.timeline-panel {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  padding: 1.25rem;
  margin: 0 0 2rem;
  background: var(--hw-surface);
}
.mono {
  font-family: var(--hw-mono);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}
.head p {
  margin: 0;
}
.dur {
  font-size: 0.85rem;
  color: var(--hw-ink-faint);
}
.track {
  position: relative;
  height: 44px;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  background: var(--hw-surface);
  cursor: crosshair;
  touch-action: none;
  overflow: hidden;
}
/* The speech runs as a quiet band the full height; music blocks sit over it. */
.speech {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: var(--hw-pink-wash);
}
.grid {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--hw-rule);
  opacity: 0.6;
}
.chapter {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: var(--hw-ink-faint);
}
.slot {
  position: absolute;
  top: 6px;
  bottom: 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.2rem;
  padding: 0 0.25rem;
  border-radius: 3px;
  box-sizing: border-box;
  color: var(--hw-surface);
  overflow: hidden;
  cursor: grab;
}
.slot.dragging {
  cursor: grabbing;
  opacity: 0.85;
}
.slot.break {
  background: var(--hw-pink);
}
.slot.intro,
.slot.outro {
  background: var(--hw-leaf);
}
.tag {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  pointer-events: none;
}
.x {
  border: none;
  background: transparent;
  color: inherit;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0 0.1rem;
  cursor: pointer;
  opacity: 0.75;
}
.x:hover {
  opacity: 1;
}
.edge {
  position: absolute;
  bottom: 2px;
  font-size: 0.65rem;
  color: var(--hw-ink-faint);
  pointer-events: none;
}
.edge.start {
  left: 4px;
}
.edge.end {
  right: 4px;
}
.hint {
  margin: 0.6rem 0 0;
  font-size: 0.72rem;
  color: var(--hw-ink-faint);
}
</style>
