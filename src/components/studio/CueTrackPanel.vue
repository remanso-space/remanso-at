<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue"

import type { TakeAnalysis } from "../../modules/studio/analyzeTake"
import { BED_IDS, renderBed } from "../../modules/studio/beds"
import { audioMimeType, cueExtension } from "../../modules/studio/cueImport"
import {
  addBedClip,
  addCueFileClip,
  addRoomToneFill,
  clipDurationSec,
  cueTrack,
  removeCueClip,
  setCueClipDuck,
  setCueClipMuted,
  timelineDurationSec,
} from "../../modules/studio/edl"
import type { BedId, Session } from "../../modules/studio/edl.types"
import { bitrateFor, contentTier, minutesAtTier } from "../../modules/studio/mediaCodec"
import { writeCueFile } from "../../modules/studio/opfsCues"
import { snapPoints } from "../../modules/studio/snap"
import { formatDuration } from "../../utils/formatDuration"

// The cue track: music, sounds and procedural ambient laid under the speech. Placement is
// by snap target, not free drag — landing a sting ON a speech onset is the whole point, and
// a picker of the onsets/flags/clip-boundaries the derush pass already found gets there
// without a timeline canvas nobody would finish building. Hold nothing, pick a moment.
//
// Every edit is a pure EDL op emitted up as `edit`; this component keeps no editing state
// beyond the pending picker values. CC-BY never enters here: the built-in sounds are
// procedural and carry no licence, and an imported file is the user's own — the app builds
// no attribution machinery because there is nowhere in a WebM blob to carry attribution.

const props = defineProps<{
  session: Session
  analyses: Record<string, TakeAnalysis>
}>()

const emit = defineEmits<{ edit: [session: Session] }>()

const bed = ref<BedId>("rain")
const placeAtSec = ref(0)
const importError = ref<string | null>(null)
const importing = ref(false)

// Auditioning the selected bed. Beds carry no live playback anywhere else — they are
// procedural and only rendered at publish — so this is the one place you hear one before
// committing it. Render a few seconds off `renderBed` (the same pure function the assembler
// uses, so the preview is bit-identical to the real thing) into an AudioBuffer and play it.
const PREVIEW_SEC = 6
const PREVIEW_SR = 48_000
const auditioning = ref(false)
let audioCtx: AudioContext | null = null
let previewSource: AudioBufferSourceNode | null = null

const stopPreview = () => {
  if (previewSource) {
    previewSource.onended = null
    try {
      previewSource.stop()
    } catch {
      // already stopped
    }
    previewSource.disconnect()
    previewSource = null
  }
  auditioning.value = false
}

const tryBed = async () => {
  if (auditioning.value) {
    stopPreview()
    return
  }
  const Ctx =
    window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  audioCtx ??= new Ctx()
  await audioCtx.resume()

  const count = PREVIEW_SEC * PREVIEW_SR
  const buffer = audioCtx.createBuffer(1, count, PREVIEW_SR)
  // A fresh seed each press, so re-auditioning the same bed does not sound canned.
  renderBed(bed.value, Date.now() % 1_000_000, 0, count, buffer.getChannelData(0), PREVIEW_SR)

  const source = audioCtx.createBufferSource()
  source.buffer = buffer
  // Beds sit low under speech; audition at a matching level rather than full scale.
  const gain = audioCtx.createGain()
  gain.gain.value = 0.6
  source.connect(gain).connect(audioCtx.destination)
  source.onended = () => stopPreview()
  previewSource = source
  auditioning.value = true
  source.start()
}

onBeforeUnmount(() => {
  stopPreview()
  void audioCtx?.close()
})
let counter = 0
const nextId = () => `cue-${Date.now()}-${(counter += 1)}`

const programmeSec = computed(() => timelineDurationSec(props.session))
const clips = computed(() => cueTrack(props.session)?.clips ?? [])

// The snap targets, de-duplicated, as "place at" options. Start is always offered.
const places = computed(() => {
  const points = snapPoints(props.session, props.analyses)
  const opts = [{ atSec: 0, label: "start · 0:00" }]
  for (const p of points) {
    if (p.atSec <= 0) continue
    opts.push({ atSec: p.atSec, label: `${p.kind} · ${formatDuration(p.atSec) ?? "0:00"}` })
  }
  return opts
})

// The bitrate tension: what the cue track puts the encode in, and how many minutes that
// leaves under the 50 MB blob ceiling. Reacts to the cue clips, not just to duration.
const tier = computed(() => contentTier(props.session))
const kbps = computed(() => Math.round(bitrateFor(programmeSec.value, tier.value) / 1000))
const minutesBudget = computed(() => minutesAtTier(tier.value))

const tierLabel = computed(
  () =>
    ({ speech: "speech only", "occasional-cue": "occasional cue", "music-heavy": "music-heavy" })[
      tier.value
    ],
)

const addBed = () => {
  const remaining = Math.max(5, programmeSec.value - placeAtSec.value)
  emit(
    "edit",
    addBedClip(
      props.session,
      {
        bedId: bed.value,
        seed: Date.now() % 1_000_000,
        atSec: placeAtSec.value,
        lengthSec: remaining,
      },
      nextId(),
    ),
  )
}

const fillRoomTone = () =>
  emit("edit", addRoomToneFill(props.session, Date.now() % 1_000_000, nextId()))

const onFile = async (event: Event) => {
  const picker = event.target as HTMLInputElement
  const file = picker.files?.[0]
  picker.value = "" // let the same file be re-picked after an error
  if (!file) return

  importError.value = null
  if (!audioMimeType(file)) {
    importError.value = "That file is not audio the studio recognises."
    return
  }

  importing.value = true
  try {
    const id = nextId()
    const opfsPath = await writeCueFile(id, file, cueExtension(file))
    const durationSec = await readAudioDuration(file)
    if (!durationSec || !Number.isFinite(durationSec)) {
      importError.value = "That file's length could not be read."
      return
    }
    emit(
      "edit",
      addCueFileClip(props.session, { opfsPath, atSec: placeAtSec.value, durationSec }, `${id}:0`),
    )
  } catch {
    importError.value = "That file could not be imported."
  } finally {
    importing.value = false
  }
}

/** Playback length without a full decode — best effort, via a throwaway media element. */
const readAudioDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = new Audio()
    el.preload = "metadata"
    el.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(el.duration)
    }
    el.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(0)
    }
    el.src = url
  })

const toggleMute = (clipId: string, muted: boolean) =>
  emit("edit", setCueClipMuted(props.session, clipId, !muted))

const toggleDuck = (clipId: string, duck: "none" | "under-speech") =>
  emit("edit", setCueClipDuck(props.session, clipId, duck === "none" ? "under-speech" : "none"))

const remove = (clipId: string) => emit("edit", removeCueClip(props.session, clipId))

const clipLabel = (source: Session["tracks"][number]["clips"][number]["source"]): string =>
  source.kind === "bed" ? `bed · ${source.bedId}` : "file"
</script>

<template>
  <div class="cue">
    <div class="head">
      <p class="hw-label">§ — the cue track</p>
      <p class="tier mono" role="status">
        {{ tierLabel }} · {{ kbps }} kbps · ~{{ minutesBudget }} min budget
      </p>
    </div>

    <div class="place">
      <label class="lbl mono">Place at</label>
      <select v-model.number="placeAtSec" class="picker">
        <option v-for="(p, i) in places" :key="i" :value="p.atSec">{{ p.label }}</option>
      </select>
    </div>

    <div class="add">
      <select v-model="bed" class="picker" aria-label="Bed">
        <option v-for="b in BED_IDS" :key="b" :value="b">{{ b }}</option>
      </select>
      <button class="btn" data-test="try-bed" @click="tryBed">
        {{ auditioning ? "Stop ▪" : "Try ▸" }}
      </button>
      <button class="btn" data-test="add-bed" @click="addBed">Add bed</button>

      <label class="btn file-btn">
        {{ importing ? "Importing…" : "Import file" }}
        <input
          type="file"
          accept="audio/*"
          class="offstage"
          :disabled="importing"
          @change="onFile"
        />
      </label>

      <button class="btn" data-test="room-tone" :disabled="programmeSec <= 0" @click="fillRoomTone">
        Fill room tone
      </button>
    </div>

    <p v-if="importError" class="error">{{ importError }}</p>

    <ul v-if="clips.length" class="clips">
      <li v-for="c in clips" :key="c.id" class="clip" :class="{ muted: c.muted }">
        <span class="clip-name mono">{{ clipLabel(c.source) }}</span>
        <span class="clip-meta mono">
          {{ formatDuration(c.atSec) ?? "0:00" }} ·
          {{ formatDuration(clipDurationSec(c)) ?? "0:00" }}
          <span v-if="c.duck === 'under-speech'"> · ducked</span>
        </span>
        <button class="btn tiny" @click="toggleDuck(c.id, c.duck)">
          {{ c.duck === "under-speech" ? "Duck off" : "Duck on" }}
        </button>
        <button class="btn tiny" @click="toggleMute(c.id, !!c.muted)">
          {{ c.muted ? "Unmute" : "Mute" }}
        </button>
        <button class="btn tiny danger" @click="remove(c.id)">Remove</button>
      </li>
    </ul>
    <p v-else class="empty mono">No cues yet — beds duck under speech, stings land in the gaps.</p>
  </div>
</template>

<style scoped>
.cue {
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
.place,
.add {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}
.lbl {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
}
.picker {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  background: var(--hw-surface);
  font-family: var(--hw-mono);
  font-size: 0.8rem;
  color: var(--hw-ink);
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
.file-btn {
  position: relative;
  overflow: hidden;
}
.clips {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0;
}
.clip {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--hw-rule);
}
.clip.muted .clip-name,
.clip.muted .clip-meta {
  text-decoration: line-through;
  color: var(--hw-ink-faint);
}
.clip-name {
  font-size: 0.9rem;
  color: var(--hw-ink);
}
.clip-meta {
  flex: 1;
  font-size: 0.75rem;
  color: var(--hw-ink-faint);
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
.offstage {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  opacity: 0;
}
</style>
