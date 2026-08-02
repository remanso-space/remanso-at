<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import {
  applyCuts,
  flagAfter,
  flagBefore,
  isTakeMuted,
  keptDurationForTake,
  keptRangesForTake,
  nextKeptSec,
  nextShuttleRate,
  rejectTakeRange,
  retakeRanges,
  setTakeMuted,
  soloTake,
} from "../../modules/studio/derush"
import {
  addChapter,
  projectChapterToTimeline,
  removeChapter,
  speechDurationSec,
} from "../../modules/studio/edl"
import type { Session, Take } from "../../modules/studio/edl.types"
import { readTakeFile } from "../../modules/studio/opfsTakes"
import { formatDuration } from "../../utils/formatDuration"
import TakeWaveform from "./TakeWaveform.vue"

// The derush pass. Every edit goes through the pure functions in derush.ts and comes back
// out as an `edit` event, so this component holds no editing logic and the parent's undo
// stack only has to snapshot what it is handed (plan: "the EDL is a plain object").
//
// Keyboard is the interface — space, J/K/L, I/O, X, [ and ] — because a derush pass driven
// by dragging is a derush pass nobody finishes. Every key also has a button, for a phone
// and for discovering what the keys are.

const props = defineProps<{
  session: Session
  analyses: Record<string, TakeAnalysis>
  selectedTakeId: string
  canUndo: boolean
}>()

const emit = defineEmits<{
  edit: [session: Session]
  undo: []
  "update:selectedTakeId": [takeId: string]
}>()

const audio = ref<HTMLAudioElement | null>(null)
const takeUrl = ref<string | null>(null)
const playheadSec = ref(0)
/** Signed shuttle rate; 0 is paused. Negative runs backwards by seeking, which is the
 *  only reverse a media element offers. */
const rate = ref(0)
const inSec = ref<number | null>(null)
const outSec = ref<number | null>(null)
const skipRemoved = ref(true)

const selectedTake = computed<Take | null>(
  () => props.session.takes.find((t) => t.id === props.selectedTakeId) ?? null,
)
const analysis = computed<TakeAnalysis | null>(() => props.analyses[props.selectedTakeId] ?? null)
const kept = computed(() =>
  selectedTake.value ? keptRangesForTake(props.session, selectedTake.value.id) : [],
)
const flags = computed(() => selectedTake.value?.flags ?? [])
const retakes = computed(() =>
  selectedTake.value ? retakeRanges(selectedTake.value, analysis.value?.onsets ?? []) : [],
)
const hasRegion = computed(
  () => inSec.value !== null && outSec.value !== null && outSec.value > inSec.value,
)
const programmeSec = computed(() => speechDurationSec(props.session))

const revokeUrl = () => {
  if (takeUrl.value) URL.revokeObjectURL(takeUrl.value)
  takeUrl.value = null
}

watch(
  selectedTake,
  async (take) => {
    revokeUrl()
    rate.value = 0
    playheadSec.value = 0
    inSec.value = null
    outSec.value = null
    if (!take) return
    const file = await readTakeFile(take.opfsPath)
    if (file) takeUrl.value = URL.createObjectURL(file)
  },
  { immediate: true },
)

// ── transport ───────────────────────────────────────────────────────────────────────

const seek = (sec: number) => {
  const el = audio.value
  const clamped = Math.max(0, Math.min(selectedTake.value?.durationSec ?? 0, sec))
  playheadSec.value = clamped
  if (el) el.currentTime = clamped
}

// Each play/pause bumps this. A play() interrupted by a later pause() (pausing, or
// shuttling backward) rejects with an AbortError long after the fact; without a token that
// stale rejection would reset `rate` to 0 and cancel whatever the user just started — the
// button "doing something" after a first play, and reverse dying the instant you shuttle
// back off a forward play.
let transportGen = 0

const applyRate = () => {
  const el = audio.value
  if (!el) return
  const gen = (transportGen += 1)
  if (rate.value > 0) {
    el.playbackRate = rate.value
    // Wrapped rather than chained: a media element that refuses to play may return
    // nothing at all instead of a rejected promise. Only a still-current, still-forward
    // play that genuinely failed drops the transport to paused.
    void Promise.resolve(el.play()).catch(() => {
      if (gen === transportGen && rate.value > 0) rate.value = 0
    })
  } else {
    el.pause()
  }
}

// Sync flush so the play()/pause() lands inside the click that set the rate — a microtask
// later can fall outside the user-gesture window some autoplay policies check, and the
// button feels laggy waiting for it.
watch(rate, applyRate, { flush: "sync" })

const togglePlay = () => (rate.value = rate.value === 0 ? 1 : 0)
const shuttle = (direction: 1 | -1) => (rate.value = nextShuttleRate(rate.value, direction))

let raf = 0
let lastFrameMs = 0

const frame = (now: number) => {
  const dt = lastFrameMs ? (now - lastFrameMs) / 1000 : 0
  lastFrameMs = now
  const el = audio.value

  if (el && rate.value < 0) {
    el.currentTime = Math.max(0, el.currentTime + rate.value * dt)
    if (el.currentTime <= 0) rate.value = 0
  }
  // The playhead follows the element only while transport is running. Paused, it is
  // whatever the last seek or jump set — a media element that quietly refuses to move
  // must not drag the marker back to zero under the cursor.
  if (el && rate.value !== 0) {
    // Playback hears the programme, not the tape: while running forward, jump whatever the
    // EDL has removed. Left alone while scrubbing back, so you can still look at a
    // rejected region before putting it back.
    if (skipRemoved.value && rate.value > 0) {
      const next = nextKeptSec(kept.value, el.currentTime)
      if (next === null) rate.value = 0
      else if (next > el.currentTime + 0.02) el.currentTime = next
    }
    playheadSec.value = el.currentTime
  }
  raf = requestAnimationFrame(frame)
}

// ── edits ───────────────────────────────────────────────────────────────────────────

const clearRegion = () => {
  inSec.value = null
  outSec.value = null
}

// Setting one end past the other drops the other rather than swapping: you meant the mark
// you just placed, and a silently reversed region is how you reject the wrong four seconds.
const setIn = () => {
  inSec.value = playheadSec.value
  if (outSec.value !== null && outSec.value <= inSec.value) outSec.value = null
}

const setOut = () => {
  outSec.value = playheadSec.value
  if (inSec.value !== null && inSec.value >= outSec.value) inSec.value = null
}

const rejectRegion = () => {
  const take = selectedTake.value
  if (!take || !hasRegion.value) return
  emit("edit", rejectTakeRange(props.session, take.id, inSec.value!, outSec.value!))
  clearRegion()
}

const removePauses = () => {
  const take = selectedTake.value
  if (!take || !analysis.value?.cuts.length) return
  emit("edit", applyCuts(props.session, take.id, analysis.value.cuts))
}

/** A retake flag becomes a rejectable region: the line it condemned, cut in one go. */
const cutFlaggedRetakes = () => {
  const take = selectedTake.value
  if (!take || retakes.value.length === 0) return
  let next = props.session
  for (const region of retakes.value)
    next = rejectTakeRange(next, take.id, region.inSec, region.outSec)
  emit("edit", next)
}

const markRegionFromRetake = (region: { inSec: number; outSec: number }) => {
  inSec.value = region.inSec
  outSec.value = region.outSec
  seek(region.inSec)
}

const jumpFlag = (direction: 1 | -1) => {
  const flag =
    direction === 1
      ? flagAfter(flags.value, playheadSec.value)
      : flagBefore(flags.value, playheadSec.value)
  if (flag) seek(flag.atTakeSec)
}

const toggleMute = (take: Take) =>
  emit("edit", setTakeMuted(props.session, take.id, !isTakeMuted(props.session, take.id)))

const solo = (take: Take) => emit("edit", soloTake(props.session, take.id))

// ── chapters ──────────────────────────────────────────────────────────────────────────
// A chapter is dropped against the take at the playhead, in take seconds, so it rides
// through every later edit and projects to the timeline at render — and doubles as a cue
// snap target.

const dropChapter = () => {
  const take = selectedTake.value
  if (!take) return
  emit("edit", addChapter(props.session, { takeId: take.id, atTakeSec: playheadSec.value }))
}

const chapters = computed(() =>
  props.session.chapters.map((c, i) => ({
    index: i,
    atTimelineSec: projectChapterToTimeline(props.session, c),
  })),
)

// ── keyboard ────────────────────────────────────────────────────────────────────────

const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

const typing = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || FORM_TAGS.has(el.tagName)
}

const onKeydown = (event: KeyboardEvent) => {
  if (typing(event.target)) return

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault()
    emit("undo")
    return
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return

  switch (event.key.toLowerCase()) {
    case " ":
      togglePlay()
      break
    case "j":
      shuttle(-1)
      break
    case "k":
      rate.value = 0
      break
    case "l":
      shuttle(1)
      break
    case "i":
      setIn()
      break
    case "o":
      setOut()
      break
    case "x":
      rejectRegion()
      break
    case "[":
      jumpFlag(-1)
      break
    case "]":
      jumpFlag(1)
      break
    case "c":
      dropChapter()
      break
    default:
      return
  }
  event.preventDefault()
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  cancelAnimationFrame(raf)
  revokeUrl()
})

const lufsLabel = (takeId: string): string => {
  const lufs = props.analyses[takeId]?.lufs
  return lufs === null || lufs === undefined ? "—" : `${lufs.toFixed(1)} LUFS`
}
</script>

<template>
  <div class="derush">
    <div class="head">
      <p class="hw-label">§ — derush</p>
      <p class="programme mono">
        Programme {{ formatDuration(programmeSec) ?? "0:00" }}
        <span v-if="session.takes.length > 1"> · {{ session.takes.length }} takes</span>
      </p>
    </div>

    <!-- Take list: pick one to review, mute or solo it for best-of-N -->
    <ul class="takes">
      <li
        v-for="t in session.takes"
        :key="t.id"
        class="take"
        :class="{ current: t.id === selectedTakeId, muted: isTakeMuted(session, t.id) }"
      >
        <button class="take-pick" @click="emit('update:selectedTakeId', t.id)">
          <span class="take-name mono">{{ formatDuration(t.durationSec) ?? "0:00" }}</span>
          <span class="take-meta mono">
            {{ formatDuration(keptDurationForTake(session, t.id)) ?? "0:00" }} kept ·
            {{ t.flags.length }} flags · {{ lufsLabel(t.id) }}
          </span>
        </button>
        <button class="btn tiny" @click="toggleMute(t)">
          {{ isTakeMuted(session, t.id) ? "Unmute" : "Mute" }}
        </button>
        <button
          v-if="session.takes.length > 1"
          class="btn tiny"
          title="Keep only this take"
          @click="solo(t)"
        >
          Solo
        </button>
      </li>
    </ul>

    <template v-if="selectedTake">
      <TakeWaveform
        :peaks="analysis?.peaks ?? null"
        :duration-sec="selectedTake.durationSec"
        :kept="kept"
        :flags="flags"
        :cuts="analysis?.cuts ?? []"
        :onsets="analysis?.onsets ?? []"
        :playhead-sec="playheadSec"
        :in-sec="inSec"
        :out-sec="outSec"
        @seek="seek"
        @region="
          (from, to) => {
            inSec = from
            outSec = to
          }
        "
      />

      <audio ref="audio" :src="takeUrl ?? undefined" class="offstage" preload="auto" />

      <div class="transport">
        <span class="clock mono">{{ formatDuration(playheadSec) ?? "0:00" }}</span>
        <button class="btn" title="J — shuttle back" @click="shuttle(-1)">◀◀ J</button>
        <button class="btn" title="Space — play / pause" @click="togglePlay">
          {{ rate === 0 ? "▶ Play" : "❚❚ Pause" }}
        </button>
        <button class="btn" title="L — shuttle forward" @click="shuttle(1)">L ▶▶</button>
        <span v-if="rate !== 0 && Math.abs(rate) !== 1" class="rate mono">{{ rate }}×</span>
        <button class="btn" title="[ — previous flag" @click="jumpFlag(-1)">[</button>
        <button class="btn" title="] — next flag" @click="jumpFlag(1)">]</button>
      </div>

      <div class="region">
        <button class="btn" title="I — set in at the playhead" @click="setIn">Set in (I)</button>
        <button class="btn" title="O — set out at the playhead" @click="setOut">Set out (O)</button>
        <span class="region-label mono">
          <template v-if="hasRegion">
            {{ formatDuration(inSec!) }} → {{ formatDuration(outSec!) }}
          </template>
          <template v-else>no region</template>
        </span>
        <button class="btn danger" :disabled="!hasRegion" title="X — reject" @click="rejectRegion">
          Reject (X)
        </button>
        <button class="btn" :disabled="!hasRegion" @click="clearRegion">Clear</button>
      </div>

      <div class="ops">
        <button
          class="btn"
          data-test="remove-pauses"
          :disabled="!analysis?.cuts.length"
          @click="removePauses"
        >
          Remove pauses ({{ analysis?.cuts.length ?? 0 }})
        </button>
        <button
          class="btn"
          data-test="cut-retakes"
          :disabled="!retakes.length"
          @click="cutFlaggedRetakes"
        >
          Cut flagged retakes ({{ retakes.length }})
        </button>
        <label class="check">
          <input v-model="skipRemoved" type="checkbox" />
          Play kept only
        </label>
        <button class="btn" :disabled="!canUndo" title="Ctrl/⌘ Z" @click="emit('undo')">
          Undo
        </button>
      </div>

      <ul v-if="retakes.length" class="retake-list">
        <li v-for="(r, i) in retakes" :key="i">
          <button class="link-btn mono" @click="markRegionFromRetake(r)">
            retake ✕ {{ formatDuration(r.inSec) }} → {{ formatDuration(r.outSec) }}
          </button>
        </li>
      </ul>

      <!-- Chapters: a mark against the take at the playhead; a cue snap target too -->
      <div class="chapters">
        <button
          class="btn"
          data-test="drop-chapter"
          title="C — drop a chapter here"
          @click="dropChapter"
        >
          Drop chapter (C)
        </button>
        <ul v-if="chapters.length" class="chapter-list">
          <li v-for="ch in chapters" :key="ch.index" class="chapter">
            <span class="mono">
              §{{ ch.index + 1 }} ·
              {{ ch.atTimelineSec === null ? "cut" : (formatDuration(ch.atTimelineSec) ?? "0:00") }}
            </span>
            <button class="btn tiny danger" @click="emit('edit', removeChapter(session, ch.index))">
              Remove
            </button>
          </li>
        </ul>
      </div>

      <p class="keys mono">
        space play · J K L shuttle · I O in/out · X reject · [ ] jump flags · C chapter · ⌘/ctrl Z
        undo
      </p>
    </template>
  </div>
</template>

<style scoped>
.derush {
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
.programme {
  font-size: 0.85rem;
  color: var(--hw-ink-faint);
}
.takes {
  list-style: none;
  padding: 0;
  margin: 0 0 1rem;
}
.take {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--hw-rule);
}
.take.current {
  background: var(--hw-pink-wash);
}
.take.muted .take-name,
.take.muted .take-meta {
  text-decoration: line-through;
  color: var(--hw-ink-faint);
}
.take-pick {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0.15rem 0.35rem;
  color: var(--hw-ink);
}
.take-pick:hover .take-name {
  color: var(--hw-pink-deep);
}
.take-name {
  font-size: 0.95rem;
}
.take-meta {
  font-size: 0.75rem;
  color: var(--hw-ink-faint);
}
.transport,
.region,
.ops {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.75rem;
}
.clock {
  min-width: 3.5rem;
  font-size: 1.05rem;
}
.rate,
.region-label {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
}
.btn {
  padding: 0.35rem 0.7rem;
  font-family: var(--hw-mono);
  font-size: 0.8rem;
  cursor: pointer;
  border: 1px solid var(--hw-rule);
  background: transparent;
  color: var(--hw-ink-soft);
  border-radius: 4px;
}
.btn:hover:not(:disabled) {
  color: var(--hw-pink-deep);
  border-color: var(--hw-pink);
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.btn.tiny {
  padding: 0.2rem 0.45rem;
  font-size: 0.7rem;
}
.btn.danger:hover:not(:disabled) {
  color: #c0392b;
  border-color: #c0392b;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: var(--hw-ink-soft);
}
.retake-list {
  list-style: none;
  padding: 0;
  margin: 0.75rem 0 0;
}
.link-btn {
  background: none;
  border: none;
  padding: 0.1rem 0;
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--hw-pink-deep);
}
.chapters {
  margin-top: 0.9rem;
}
.chapter-list {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.chapter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.78rem;
  color: var(--hw-ink-soft);
}
.keys {
  margin: 0.9rem 0 0;
  font-size: 0.72rem;
  color: var(--hw-ink-faint);
}
.offstage {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}
</style>
