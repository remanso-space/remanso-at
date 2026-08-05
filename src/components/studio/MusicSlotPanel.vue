<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { speechDurationSec } from "../../modules/studio/edl"
import type { MusicSlot, Session, SlotAnchor, SlotKind } from "../../modules/studio/edl.types"
import { bitrateFor, contentTier, minutesAtTier } from "../../modules/studio/mediaCodec"
import {
  addSlot,
  applySpeechBreaks,
  clipsForSlot,
  fillSlot,
  newSlot,
  programmeDurationSec,
  removeSlot,
  resolveAnchorSec,
  updateSlot,
} from "../../modules/studio/musicSlots"
import {
  fetchToOpfs,
  PRESET_QUERIES,
  searchMusic,
  type MusicResult,
} from "../../modules/studio/openverse"
import { snapPoints } from "../../modules/studio/snap"
import { formatDuration } from "../../utils/formatDuration"

// Music slots: name a moment, put a track under it. The panel never edits clips — every
// control writes one field on one slot, and the cue track the renderer sees is projected
// from those slots. So there is nothing here to keep in sync and nothing to drag.
//
// The picker previews straight from the provider's CDN and writes to OPFS only when a
// result is picked, so browsing costs nothing but the search request.

const props = defineProps<{
  session: Session
  analyses: Record<string, TakeAnalysis>
}>()

const emit = defineEmits<{ edit: [session: Session] }>()

let counter = 0
const nextId = () => `slot-${Date.now()}-${(counter += 1)}`

// The rendered length, real-break silences included — so the bitrate/minutes budget is honest.
const programmeSec = computed(() => programmeDurationSec(applySpeechBreaks(props.session)))
const slots = computed(() => props.session.musicSlots)

/** Where a slot may be anchored: the start, the snap targets derush found, the speech end. */
const places = computed(() => {
  const opts: { value: string; label: string; anchor: SlotAnchor }[] = [
    { value: "abs:0", label: "start · 0:00", anchor: { kind: "absolute", atSec: 0 } },
  ]
  for (const p of snapPoints(props.session, props.analyses)) {
    if (p.atSec <= 0) continue
    opts.push({
      value: `abs:${p.atSec}`,
      label: `${p.kind} · ${formatDuration(p.atSec) ?? "0:00"}`,
      anchor: { kind: "absolute", atSec: p.atSec },
    })
  }
  props.session.chapters.forEach((chapter, index) => {
    opts.push({
      value: `chapter:${index}`,
      label: `chapter ${index + 1}${chapter.title ? ` · ${chapter.title}` : ""}`,
      anchor: { kind: "chapter", chapterIndex: index },
    })
  })
  opts.push({ value: "speech-end", label: "after the last word", anchor: { kind: "speech-end" } })
  return opts
})

const anchorValue = (slot: MusicSlot): string => {
  if (slot.anchor.kind === "absolute") return `abs:${slot.anchor.atSec}`
  if (slot.anchor.kind === "chapter") return `chapter:${slot.anchor.chapterIndex}`
  return "speech-end"
}

const setAnchor = (slot: MusicSlot, value: string) => {
  const anchor = places.value.find((p) => p.value === value)?.anchor
  if (anchor) emit("edit", updateSlot(props.session, slot.id, { anchor }))
}

const setLength = (slot: MusicSlot, value: string) => {
  const lengthSec = Math.max(1, Math.min(600, Number(value) || 0))
  emit("edit", updateSlot(props.session, slot.id, { lengthSec }))
}

const setGain = (slot: MusicSlot, value: string) =>
  emit("edit", updateSlot(props.session, slot.id, { gainDb: Number(value) }))

const toggleDuck = (slot: MusicSlot) =>
  emit("edit", updateSlot(props.session, slot.id, { duck: !slot.duck }))

const togglePause = (slot: MusicSlot) =>
  emit("edit", updateSlot(props.session, slot.id, { pauseSpeech: !slot.pauseSpeech }))

const add = (kind: SlotKind) => {
  const slot = newSlot(kind, nextId())
  emit("edit", addSlot(props.session, slot))
  openPicker(slot.id)
}

const remove = (slotId: string) => {
  if (pickerFor.value === slotId) pickerFor.value = null
  emit("edit", removeSlot(props.session, slotId))
}

/** What a slot resolves to, said plainly — "nowhere" is a real state worth showing. */
const slotWhere = (slot: MusicSlot): string => {
  const atSec = resolveAnchorSec(props.session, slot)
  if (atSec === null) return "its chapter was edited out"
  // A real break is a pause: the recording stops here and resumes after the music plays out.
  if (slot.kind === "break" && slot.pauseSpeech) {
    const from = formatDuration(atSec) ?? "0:00"
    const to = formatDuration(atSec + slot.lengthSec) ?? "0:00"
    return `pauses at ${from} · ${slot.lengthSec}s · resumes ${to}`
  }
  const parts = clipsForSlot(props.session, slot)
  const looped = parts.length > 1 ? ` · looped ×${parts.length}` : ""
  return `${formatDuration(atSec) ?? "0:00"} · ${slot.lengthSec}s${looped}`
}

// —— The picker ——

const pickerFor = ref<string | null>(null)
const query = ref("")
const results = ref<MusicResult[]>([])
const searching = ref(false)
const searchError = ref<string | null>(null)
const fetchingId = ref<string | null>(null)
const previewId = ref<string | null>(null)
let preview: HTMLAudioElement | null = null

const openPicker = (slotId: string) => {
  pickerFor.value = pickerFor.value === slotId ? null : slotId
  searchError.value = null
}

const stopPreview = () => {
  preview?.pause()
  preview = null
  previewId.value = null
}

const togglePreview = (result: MusicResult) => {
  if (previewId.value === result.id) {
    stopPreview()
    return
  }
  stopPreview()
  const el = new Audio(result.audioUrl)
  el.volume = 0.7
  el.onended = () => stopPreview()
  el.onerror = () => stopPreview()
  preview = el
  previewId.value = result.id
  void el.play().catch(() => stopPreview())
}

onBeforeUnmount(stopPreview)

const runSearch = async (text: string) => {
  query.value = text
  if (!text.trim()) return
  searching.value = true
  searchError.value = null
  const outcome = await searchMusic(text)
  searching.value = false
  if (!outcome.ok) {
    results.value = []
    searchError.value = outcome.error
    return
  }
  results.value = outcome.results
  if (outcome.results.length === 0) searchError.value = "Nothing openly licensed matched that."
}

const pick = async (slotId: string, result: MusicResult) => {
  stopPreview()
  fetchingId.value = result.id
  const picked = await fetchToOpfs(result)
  fetchingId.value = null
  if (!picked) {
    searchError.value = "That track could not be downloaded."
    return
  }
  emit("edit", fillSlot(props.session, slotId, picked))
  pickerFor.value = null
}

// The bitrate tension, same as the cue track surfaced: what the music costs the encode and
// how many minutes that leaves under the 50 MB blob ceiling.
const tier = computed(() => contentTier(props.session))
const kbps = computed(() => Math.round(bitrateFor(programmeSec.value, tier.value) / 1000))
const minutesBudget = computed(() => minutesAtTier(tier.value))
const tierLabel = computed(
  () =>
    ({ speech: "speech only", "occasional-cue": "occasional cue", "music-heavy": "music-heavy" })[
      tier.value
    ],
)

const hasSpeech = computed(() => speechDurationSec(props.session) > 0)
</script>

<template>
  <div class="slots">
    <div class="head">
      <p class="hw-label">§ — music</p>
      <p class="tier mono" role="status">
        {{ tierLabel }} · {{ kbps }} kbps · ~{{ minutesBudget }} min budget
      </p>
    </div>

    <div class="add">
      <button class="btn" data-test="add-intro" :disabled="!hasSpeech" @click="add('intro')">
        Add intro
      </button>
      <button class="btn" data-test="add-break" :disabled="!hasSpeech" @click="add('break')">
        Add break
      </button>
      <button class="btn" data-test="add-outro" :disabled="!hasSpeech" @click="add('outro')">
        Add outro
      </button>
    </div>

    <ul v-if="slots.length" class="list">
      <li v-for="slot in slots" :key="slot.id" class="slot">
        <div class="row">
          <span class="kind mono">{{ slot.kind }}</span>

          <select
            class="picker"
            :value="anchorValue(slot)"
            aria-label="Anchor"
            @change="setAnchor(slot, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="p in places" :key="p.value" :value="p.value">{{ p.label }}</option>
          </select>

          <label class="lbl mono">
            length
            <input
              class="num"
              type="number"
              min="1"
              max="600"
              :value="slot.lengthSec"
              @change="setLength(slot, ($event.target as HTMLInputElement).value)"
            />
          </label>

          <label class="lbl mono">
            gain
            <input
              class="num"
              type="number"
              min="-40"
              max="6"
              :value="slot.gainDb"
              @change="setGain(slot, ($event.target as HTMLInputElement).value)"
            />
          </label>

          <button class="btn tiny" @click="toggleDuck(slot)">
            {{ slot.duck ? "Duck on" : "Duck off" }}
          </button>
          <button
            v-if="slot.kind === 'break'"
            class="btn tiny"
            :class="{ on: slot.pauseSpeech }"
            :data-test="`pause-${slot.id}`"
            title="Pause the recording under this break instead of playing over the next phrase"
            @click="togglePause(slot)"
          >
            {{ slot.pauseSpeech ? "Pause on" : "Pause off" }}
          </button>
          <button class="btn tiny danger" @click="remove(slot.id)">Remove</button>
        </div>

        <div class="row sub">
          <span class="meta mono">{{ slotWhere(slot) }}</span>
          <template v-if="slot.pick">
            <span class="track">{{ slot.pick.credit.title }}</span>
            <span class="meta mono">
              {{ slot.pick.credit.creator }} ·
              <a :href="slot.pick.credit.licenseUrl" target="_blank" rel="noopener">
                {{ slot.pick.credit.license === "cc0" ? "CC0" : "CC BY" }}
              </a>
            </span>
            <button class="btn tiny" @click="openPicker(slot.id)">Replace</button>
          </template>
          <button
            v-else
            class="btn tiny"
            :data-test="`find-${slot.id}`"
            @click="openPicker(slot.id)"
          >
            Find music
          </button>
        </div>

        <div v-if="pickerFor === slot.id" class="finder">
          <div class="chips">
            <button v-for="q in PRESET_QUERIES" :key="q" class="chip mono" @click="runSearch(q)">
              {{ q }}
            </button>
          </div>
          <div class="search">
            <input
              v-model="query"
              class="text"
              type="search"
              placeholder="Search openly licensed audio"
              @keyup.enter="runSearch(query)"
            />
            <button
              class="search-btn"
              :disabled="searching"
              :aria-label="searching ? 'Searching' : 'Search'"
              @click="runSearch(query)"
            >
              {{ searching ? "Searching…" : "Search" }}
            </button>
          </div>

          <p v-if="searchError" class="error">{{ searchError }}</p>

          <ul v-if="results.length" class="results">
            <li v-for="r in results" :key="r.id" class="result">
              <button class="btn tiny" @click="togglePreview(r)">
                {{ previewId === r.id ? "Stop ▪" : "Hear ▸" }}
              </button>
              <span class="track">{{ r.title }}</span>
              <span class="meta mono">
                {{ r.creator }} · {{ formatDuration(r.durationSec) ?? "0:00" }} ·
                {{ r.credit.license === "cc0" ? "CC0" : "CC BY" }}
              </span>
              <button class="btn tiny" :disabled="!!fetchingId" @click="pick(slot.id, r)">
                {{ fetchingId === r.id ? "Fetching…" : "Use" }}
              </button>
            </li>
          </ul>
        </div>
      </li>
    </ul>
    <p v-else class="empty mono">
      No music yet — an intro opens over the first words, a break lands on a chapter, an outro plays
      out after the last one.
    </p>
  </div>
</template>

<style scoped>
.slots {
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
.tier {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
}
.add {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.slot {
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--hw-rule);
}
.row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.row.sub {
  margin-top: 0.35rem;
}
.kind {
  font-size: 0.8rem;
  color: var(--hw-pink-deep);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.lbl {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  color: var(--hw-ink-faint);
}
.picker,
.num,
.text {
  padding: 0.3rem 0.45rem;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  background: var(--hw-surface);
  font-family: var(--hw-mono);
  font-size: 0.8rem;
  color: var(--hw-ink);
}
.num {
  width: 4.5rem;
}
.text {
  flex: 1;
  min-width: 12rem;
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
.btn.on {
  color: var(--hw-surface);
  background: var(--hw-pink);
  border-color: var(--hw-pink);
}
.btn.danger:hover:not(:disabled) {
  color: #c0392b;
  border-color: #c0392b;
}
.track {
  font-size: 0.85rem;
  color: var(--hw-ink);
}
.meta {
  font-size: 0.75rem;
  color: var(--hw-ink-faint);
}
.meta a {
  color: inherit;
}
.finder {
  margin: 0.6rem 0 0.2rem;
  padding: 0.6rem;
  border: 1px dashed var(--hw-rule);
  border-radius: 4px;
}
.chips {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}
.chip {
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  cursor: pointer;
  border: 1px solid var(--hw-rule);
  border-radius: 999px;
  background: transparent;
  color: var(--hw-ink-soft);
}
.chip:hover {
  color: var(--hw-pink-deep);
  border-color: var(--hw-pink);
}
/* Input and its Search action are one control: the button rides in the input's suffix,
   sharing a border that lights up together on focus. */
.search {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  overflow: hidden;
  background: var(--hw-surface);
}
.search:focus-within {
  border-color: var(--hw-pink);
}
.search .text {
  flex: 1;
  min-width: 10rem;
  border: none;
  border-radius: 0;
  background: transparent;
}
.search .text:focus {
  outline: none;
}
.search-btn {
  border: none;
  border-left: 1px solid var(--hw-rule);
  background: transparent;
  padding: 0 0.9rem;
  font-family: var(--hw-mono);
  font-size: 0.8rem;
  white-space: nowrap;
  color: var(--hw-pink-deep);
  cursor: pointer;
}
.search-btn:hover:not(:disabled) {
  background: var(--hw-pink);
  color: var(--hw-surface);
}
.search-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.results {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.result {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}
.result .track {
  flex: 1;
  min-width: 8rem;
}
.empty {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
  margin: 0.5rem 0 0;
}
.error {
  color: #c0392b;
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}
</style>
