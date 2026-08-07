<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue"
import { useAtprotoLogin } from "vue-atproto-login"

import MusicSlotPanel from "../components/studio/MusicSlotPanel.vue"
import DerushPanel from "../components/studio/DerushPanel.vue"
import ProgrammeTimeline from "../components/studio/ProgrammeTimeline.vue"
import { useTakeRecorder } from "../composables/useTakeRecorder"
import { parseAtUri } from "../modules/atproto/parseAtUri"
import {
  listPublishedNotes,
  recordingAltFor,
  type PublishedNote,
} from "../modules/atproto/publishedNotes"
import { toShortDid } from "../modules/atproto/shortDid"
import type { TakePcm } from "../modules/studio/assemble"
import { analyzeTakeFile, type TakeAnalysis } from "../modules/studio/analyzeTake"
import { removeTake as removeTakeFromEdl } from "../modules/studio/derush"
import { addTake, newSession } from "../modules/studio/edl"
import { programmeDurationSec } from "../modules/studio/musicSlots"
import type { Session } from "../modules/studio/edl.types"
import { SESSION_SAMPLE_RATE } from "../modules/studio/edl.types"
import { canUndo as historyCanUndo, commit, historyOf, undo } from "../modules/studio/history"
import { canEncodeOpus } from "../modules/studio/mediaCodec"
import { deletePeaks, writePeaks } from "../modules/studio/opfsPeaks"
import { deleteTake, readTakeFile } from "../modules/studio/opfsTakes"
import { publishSession } from "../modules/studio/publishSession"
import { renderToPcm, type RenderProgress } from "../modules/studio/renderToPcm"
import { encodeWav } from "../modules/studio/wav"
import { formatDuration } from "../utils/formatDuration"

const { isLoggedIn, handle, did } = useAtprotoLogin()
const recorder = useTakeRecorder()

type Gate = "checking" | "ok" | "unsupported"
const gate = ref<Gate>("checking")

const notes = ref<PublishedNote[]>([])
const notesError = ref<string | null>(null)
const loadingNotes = ref(false)

const title = ref("")

// The EDL is the state of the studio now, and the undo stack is a list of past EDLs — the
// review pass edits it, publish just renders whatever it says. Held shallow on purpose:
// its snapshots are plain objects and Vue has no reason to walk into every clip.
const sessionId = `session-${Date.now()}`
const history = shallowRef(historyOf(newSession(sessionId, "")))
const session = computed<Session>(() => history.value.present)
const canUndo = computed(() => historyCanUndo(history.value))
const edit = (next: Session) => (history.value = commit(history.value, next))

// A recorded take is a new baseline, not an undoable step. Undo is the derush pass, and it
// must never peel a recording back off and leave the studio with nothing to publish. Prior
// edits are banked into this baseline; undo afterwards reaches back only to here.
const recordTake = (next: Session) => (history.value = historyOf(next))

// Decoded samples and the analysis overlays, by take id. Neither is reactive per-element:
// these are megabytes of Float32Array, and only ever swapped wholesale.
const takePcm: TakePcm = {}
const analyses = shallowRef<Record<string, TakeAnalysis>>({})
const selectedTakeId = ref("")
const analysing = ref(false)
const takeWarning = ref<string | null>(null)

type PublishState = "idle" | "publishing" | "done" | "error"
const publishState = ref<PublishState>("idle")
const link = ref("")
const publishError = ref<string | null>(null)
const copied = ref(false)

// One bar, shared by publish and preview: both run the same decode-and-render, so both
// report through the same reading and the template shows whichever is live.
const progress = ref<RenderProgress | null>(null)

// The final-cut preview: render exactly what publish would — pauses removed, intro and
// breaks assembled, chain applied — wrap it as a WAV blob and hand it to an <audio> element.
// The element is what makes the cut walkable: native play, pause, scrub and seek, so the
// author can jump straight to the break they are unsure about instead of sitting through it.
type PreviewState = "idle" | "rendering" | "ready"
const previewState = ref<PreviewState>("idle")
const previewError = ref<string | null>(null)
const previewAudio = ref<HTMLAudioElement | null>(null)
const previewUrl = ref<string | null>(null)
const previewPlaying = ref(false)
const previewPosSec = ref(0)
const previewDurSec = ref(0)

const revokePreviewUrl = () => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

/** Tear the preview down: stop the element, free the blob, and forget the transport. */
const stopPreview = () => {
  previewAudio.value?.pause()
  revokePreviewUrl()
  previewPlaying.value = false
  previewPosSec.value = 0
  previewDurSec.value = 0
  if (previewState.value !== "rendering") previewState.value = "idle"
}

const previewFinal = async () => {
  // A second click while a preview is loaded closes it; while it is still rendering, cancels.
  if (previewState.value !== "idle") {
    stopPreview()
    previewState.value = "idle"
    return
  }
  previewError.value = null
  previewState.value = "rendering"
  progress.value = { fraction: 0, label: "Rendering the programme…" }
  try {
    const result = await renderToPcm({
      session: session.value,
      takePcm,
      onProgress: (p) => (progress.value = p),
    })
    if (!result.ok) {
      previewError.value = result.error
      previewState.value = "idle"
      return
    }
    revokePreviewUrl()
    previewUrl.value = URL.createObjectURL(encodeWav(result.render.samples, SESSION_SAMPLE_RATE))
    previewDurSec.value = result.render.durationSec
    previewState.value = "ready"
    // Wait for the new src to bind before asking the element to play it.
    await nextTick()
    void previewAudio.value?.play().catch(() => (previewPlaying.value = false))
  } catch (err) {
    previewError.value = err instanceof Error ? err.message : "The preview could not be rendered."
    previewState.value = "idle"
  } finally {
    progress.value = null
  }
}

const togglePreviewPlay = () => {
  const el = previewAudio.value
  if (!el) return
  if (el.paused) void el.play().catch(() => (previewPlaying.value = false))
  else el.pause()
}

const seekPreview = (value: string) => {
  const el = previewAudio.value
  if (!el) return
  el.currentTime = Number(value)
  previewPosSec.value = el.currentTime
}

onBeforeUnmount(stopPreview)

// What this cut attached itself to, snapshotted at publish. The note list stays live
// underneath, and picking another note afterwards must not rewrite the confirmation.
const attachedTo = ref<{ title: string; url: string } | null>(null)

const hasProgramme = computed(() => programmeDurationSec(session.value) > 0)

const loadNotes = async () => {
  if (!did.value) return
  loadingNotes.value = true
  notesError.value = null
  const result = await listPublishedNotes({ did: did.value })
  loadingNotes.value = false
  if (result.ok) notes.value = result.notes
  else notesError.value = `Could not load your notes (${result.reason}).`
}

onMounted(async () => {
  // The single point of failure: no Opus encode means no deliverable, and there is no
  // original to fall back to. Refuse clearly rather than fail at the end.
  gate.value = (await canEncodeOpus()) ? "ok" : "unsupported"
  await recorder.refreshDevices()
  if (isLoggedIn.value) void loadNotes()
})

watch(isLoggedIn, (yes) => {
  if (yes) void loadNotes()
})

// The note is the thing being recorded for, so it sits with the title it fills rather than
// at the foot of the page. Once picked, the list folds away to a single line — the pick is
// the answer to "what is this take for", and the browse UI has served its purpose.
const pickedUri = ref("")
const pickedNote = computed(() => notes.value.find((n) => n.record.uri === pickedUri.value))

// Browsing is the default until a note is picked; afterwards it is reopened on demand.
const browsing = ref(false)
const noteFilter = ref("")
const shownNotes = computed(() => {
  const query = noteFilter.value.trim().toLowerCase()
  if (!query) return notes.value
  return notes.value.filter((n) => n.record.value.title.toLowerCase().includes(query))
})

// remanso.space routes a public note at /pub/:shortDid/:rkey/:slug? — the slug is
// decorative, so the two-segment form is enough to land on the note.
const noteUrl = (did: string, rkey: string) =>
  `https://remanso.space/pub/${toShortDid(did)}/${rkey}`

/**
 * Where a note of yours reads on the web. Browsing a title is often not enough to know
 * which note it is, so every row opens in a new tab — the studio session, half-recorded,
 * must survive the look. The did comes off the note's own uri rather than the session so
 * a malformed uri cannot take the whole list down with a throw.
 */
const publicNoteUrl = (note: PublishedNote): string => {
  try {
    const { did: noteDid, rkey } = parseAtUri(note.record.uri)
    return noteUrl(noteDid, rkey)
  } catch {
    return ""
  }
}

const pickNote = (note: PublishedNote) => {
  title.value = note.record.value.title
  pickedUri.value = note.record.uri
  browsing.value = false
  noteFilter.value = ""
}

/** Record with no note behind it: the publish then hands back a link to paste instead. */
const detachNote = () => {
  pickedUri.value = ""
  browsing.value = true
}

const startRecording = async () => {
  publishState.value = "idle"
  link.value = ""
  attachedTo.value = null
  takeWarning.value = null
  await recorder.start()
}

/**
 * Stop, then run the one decode the rest of the session lives off: peaks for the waveform,
 * pause candidates, speech onsets and a loudness reading, plus the samples publish would
 * otherwise decode a second time. The take is appended either way — a take that failed to
 * analyse is still a take, and losing it to a decoder hiccup would be unforgivable.
 */
const stopRecording = async () => {
  const take = await recorder.stop()
  if (!take) return

  analysing.value = true
  const file = await readTakeFile(take.opfsPath)
  const analyzed = file ? await analyzeTakeFile(file, SESSION_SAMPLE_RATE) : null
  analysing.value = false

  if (!analyzed) {
    takeWarning.value = "That take could not be analysed, so it has no waveform. It is still here."
    recordTake(addTake(session.value, take, `${take.id}:0`))
    selectedTakeId.value = take.id
    return
  }

  const { samples, durationSec, ...analysis } = analyzed
  takePcm[take.id] = samples
  analyses.value = { ...analyses.value, [take.id]: analysis }

  const peaksPath = await writePeaks(take.id, analysis.peaks).catch(() => "")
  recordTake(addTake(session.value, { ...take, durationSec, peaksPath }, `${take.id}:0`))
  selectedTakeId.value = take.id
}

/**
 * Delete one take for good: confirm, drop it from the EDL, then free its bytes, peaks,
 * samples and analysis. Destructive and unrecoverable, so it lands on a fresh history
 * baseline — undo must never resurrect a take whose file is already gone.
 */
const deleteTakeById = async (takeId: string) => {
  const take = session.value.takes.find((t) => t.id === takeId)
  if (!take) return
  if (!window.confirm("Delete this take? Its recording is removed for good.")) return

  stopPreview()
  const next = removeTakeFromEdl(session.value, takeId)
  history.value = historyOf(next)

  await deleteTake(take.opfsPath)
  await deletePeaks(take.peaksPath)
  delete takePcm[takeId]
  const { [takeId]: _removed, ...rest } = analyses.value
  analyses.value = rest

  if (selectedTakeId.value === takeId) selectedTakeId.value = next.takes[0]?.id ?? ""
}

/** Free every take's bytes and start from an empty EDL. */
const resetSession = async () => {
  stopPreview()
  previewError.value = null
  for (const take of session.value.takes) {
    await deleteTake(take.opfsPath)
    await deletePeaks(take.peaksPath)
    delete takePcm[take.id]
  }
  history.value = historyOf(newSession(`session-${Date.now()}`, ""))
  analyses.value = {}
  selectedTakeId.value = ""
  publishState.value = "idle"
  link.value = ""
  attachedTo.value = null
  takeWarning.value = null
}

const publish = async () => {
  if (!did.value || !hasProgramme.value) return
  // Guard against a double publish: only from idle or after a prior error, never re-run
  // while publishing or once already done (that would create a duplicate recording).
  if (publishState.value === "publishing" || publishState.value === "done") return

  const note = pickedNote.value
  const noteRkey = note ? parseAtUri(note.record.uri).rkey : undefined
  // Attaching is a put at the note's rkey, so it silently replaces whatever recording is
  // already there. That is the wanted behaviour for a second cut, and a surprise otherwise.
  if (
    note?.attached &&
    !window.confirm(
      `“${note.record.value.title}” already has a recording. Publishing replaces it. Continue?`,
    )
  ) {
    return
  }

  stopPreview()
  publishState.value = "publishing"
  publishError.value = null
  progress.value = { fraction: 0, label: "Preparing…" }
  try {
    const result = await publishSession({
      did: did.value,
      session: session.value,
      title: title.value || "Untitled",
      takePcm,
      noteRkey,
      onProgress: (p) => (progress.value = p),
    })
    if (result.ok) {
      link.value = result.link ?? ""
      attachedTo.value =
        note && noteRkey
          ? { title: note.record.value.title, url: noteUrl(did.value, noteRkey) }
          : null
      publishState.value = "done"
      // The row's ♪ marker is now wrong for the note we just wrote to; refetch so a later
      // publish onto it warns about replacing this cut.
      if (note) void loadNotes()
    } else {
      publishError.value = result.error
      publishState.value = "error"
    }
  } catch (err) {
    // A thrown render (e.g. a Worker clone failure that escapes the fallback) must not leave
    // the button spinning on "Rendering…" forever — surface it as an error the author sees.
    publishError.value = err instanceof Error ? err.message : "Rendering failed unexpectedly."
    publishState.value = "error"
  } finally {
    progress.value = null
  }
}

const copyLink = async () => {
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section class="page">
    <div class="page-inner">
      <p class="hw-label eyebrow">§ — the studio</p>
      <h1 class="page-title">Record it here, keep it in your PDS.</h1>

      <!-- Signed out: the pitch -->
      <div v-if="!isLoggedIn" class="page-note">
        <p>
          Sign in with your atproto handle from the top of the page to record against your own PDS.
          You can read everything here signed out; only publishing needs an account.
        </p>
      </div>

      <template v-else>
        <p v-if="gate === 'checking'" class="status-line">Checking audio support…</p>

        <div v-else-if="gate === 'unsupported'" class="page-note danger">
          <p>
            This browser cannot encode Opus audio, and the studio has no original to fall back on.
            Try a recent Chrome, Edge or Safari 18.4+.
          </p>
        </div>

        <template v-else>
          <p class="signed-in">
            Signed in as <span class="mono">{{ handle }}</span>
          </p>

          <!-- What this take is for: the note and the title it fills, side by side, because
               the usual order is "I wrote this note, now I record it". Browsing stays one
               click away for the other order: record first, attach afterwards. -->
          <div class="target">
            <label class="field">
              <span class="field-label">Episode title</span>
              <input v-model="title" class="field-input" placeholder="Untitled" />
            </label>

            <div class="notes">
              <div class="notes-head">
                <p class="hw-label">§ — your notes</p>
                <button
                  v-if="pickedNote"
                  class="link-btn mono"
                  :aria-expanded="browsing"
                  @click="browsing = !browsing"
                >
                  {{ browsing ? "Close list" : "Change note" }}
                </button>
              </div>

              <p v-if="pickedNote" class="picked-line mono" role="status">
                <span>
                  Recording for
                  <a
                    v-if="publicNoteUrl(pickedNote)"
                    class="picked-link"
                    :href="publicNoteUrl(pickedNote)"
                    target="_blank"
                    rel="noopener"
                    title="Read on remanso.space (new tab)"
                    >“{{ pickedNote.record.value.title }}” ↗</a
                  >
                  <template v-else>“{{ pickedNote.record.value.title }}”</template>.
                </span>
                <button class="link-btn mono" @click="detachNote">Detach</button>
              </p>

              <template v-if="browsing || !pickedNote">
                <p v-if="loadingNotes" class="status-line">Loading…</p>
                <p v-else-if="notesError" class="error">{{ notesError }}</p>
                <template v-else-if="notes.length">
                  <input
                    v-model="noteFilter"
                    class="field-input note-filter mono"
                    type="search"
                    placeholder="filter your notes by title"
                    aria-label="Filter your notes by title"
                  />
                  <ul v-if="shownNotes.length" class="note-list">
                    <li
                      v-for="n in shownNotes"
                      :key="n.record.uri"
                      class="note-item"
                      :class="{ picked: n.record.uri === pickedUri }"
                    >
                      <button
                        class="note-pick"
                        :aria-pressed="n.record.uri === pickedUri"
                        @click="pickNote(n)"
                      >
                        {{ n.record.value.title }}
                      </button>
                      <span
                        v-if="n.hasAudio"
                        class="audio-flag mono"
                        role="img"
                        aria-label="Already has audio"
                        title="Already has audio"
                        >♪</span
                      >
                      <span
                        v-else
                        class="audio-flag audio-flag-mute mono"
                        role="img"
                        aria-label="No audio yet"
                        title="No audio yet"
                        >—</span
                      >
                      <a
                        v-if="publicNoteUrl(n)"
                        class="note-open mono"
                        :href="publicNoteUrl(n)"
                        target="_blank"
                        rel="noopener"
                        :aria-label="`Read “${n.record.value.title}” on remanso.space (new tab)`"
                        title="Read on remanso.space (new tab)"
                        >↗</a
                      >
                    </li>
                  </ul>
                  <p v-else class="status-line">No note matches “{{ noteFilter }}”.</p>
                </template>
                <p v-else class="status-line">No published notes found on your PDS.</p>
                <p class="hint">
                  Picking a note prefills the title and attaches the recording to that note. With no
                  note picked you get {{ recordingAltFor("title") }} to paste instead.
                </p>
              </template>
            </div>
          </div>

          <!-- The recorder -->
          <div class="recorder">
            <div class="mic-row">
              <select
                class="field-input mic-select"
                :value="recorder.deviceId.value"
                :disabled="recorder.isRecording.value"
                @change="recorder.selectDevice(($event.target as HTMLSelectElement).value)"
              >
                <option value="">Default microphone</option>
                <option v-for="d in recorder.devices.value" :key="d.deviceId" :value="d.deviceId">
                  {{ d.label || "Microphone" }}
                </option>
              </select>
            </div>

            <div class="levels" role="img" aria-label="Microphone level">
              <span
                v-for="(lvl, i) in recorder.levels.value"
                :key="i"
                class="bar"
                :style="{ height: `${6 + lvl * 94}%` }"
              />
            </div>

            <div class="transport">
              <span class="elapsed mono">{{
                formatDuration(recorder.elapsedSec.value) ?? "0:00"
              }}</span>
              <template v-if="!recorder.isRecording.value">
                <button class="btn primary" :disabled="analysing" @click="startRecording">
                  {{ session.takes.length ? "Record another take" : "Record" }}
                </button>
                <span v-if="analysing" class="flag-count mono">Analysing the take…</span>
              </template>
              <template v-else>
                <button class="btn" title="F" @click="recorder.flag('mark')">Flag ▹ (F)</button>
                <button class="btn" title="R" @click="recorder.flag('retake')">
                  Bad take ✕ (R)
                </button>
                <button class="btn primary" @click="stopRecording">Stop</button>
                <span class="flag-count mono">{{ recorder.flags.value.length }} flags</span>
              </template>
            </div>

            <p v-if="recorder.error.value" class="error">{{ recorder.error.value }}</p>
            <p v-else-if="takeWarning" class="error">{{ takeWarning }}</p>
          </div>

          <!-- Programme overview: chapters and music slots on one clean bar, click to add a
               break, drag to move it -->
          <ProgrammeTimeline
            v-if="session.takes.length && publishState !== 'done'"
            :session="session"
            :analyses="analyses"
            @edit="edit"
          />

          <!-- Derush: the review pass over the EDL -->
          <DerushPanel
            v-if="session.takes.length && publishState !== 'done'"
            v-model:selected-take-id="selectedTakeId"
            :session="session"
            :analyses="analyses"
            :pcm="takePcm[selectedTakeId] ?? null"
            :can-undo="canUndo"
            @edit="edit"
            @undo="history = undo(history)"
            @delete-take="deleteTakeById"
          />

          <!-- Music: named slots filled from an open-licence library -->
          <MusicSlotPanel
            v-if="session.takes.length && publishState !== 'done'"
            :session="session"
            :analyses="analyses"
            @edit="edit"
          />

          <!-- Publish -->
          <div v-if="session.takes.length" class="review">
            <template v-if="publishState !== 'done'">
              <div class="review-actions">
                <button
                  class="btn"
                  :disabled="
                    publishState === 'publishing' || previewState === 'rendering' || !hasProgramme
                  "
                  @click="previewFinal"
                >
                  {{ previewState === "ready" ? "✕ Close preview" : "▶ Preview final" }}
                </button>
                <button
                  class="btn primary"
                  :disabled="
                    publishState === 'publishing' || previewState === 'rendering' || !hasProgramme
                  "
                  @click="publish"
                >
                  {{ publishState === "publishing" ? "Rendering…" : "Render & publish" }}
                </button>
                <button class="btn" :disabled="publishState === 'publishing'" @click="resetSession">
                  Discard everything
                </button>
              </div>

              <p class="preview-hint mono">
                Preview is the final cut — pauses removed, intro and breaks under it. Play it, or
                drag the bar to jump anywhere in it, before you publish.
              </p>

              <!-- The final cut as a walkable player: a WAV blob behind a plain media element,
                   so play/pause and the scrub bar are the browser's own. -->
              <div v-if="previewState === 'ready'" class="preview-player">
                <audio
                  ref="previewAudio"
                  :src="previewUrl ?? undefined"
                  class="offstage"
                  preload="auto"
                  @play="previewPlaying = true"
                  @pause="previewPlaying = false"
                  @ended="previewPlaying = false"
                  @timeupdate="previewPosSec = previewAudio?.currentTime ?? 0"
                  @loadedmetadata="
                    previewDurSec = Number.isFinite(previewAudio?.duration)
                      ? (previewAudio?.duration ?? previewDurSec)
                      : previewDurSec
                  "
                />
                <button
                  class="btn"
                  :title="previewPlaying ? 'Pause' : 'Play'"
                  @click="togglePreviewPlay"
                >
                  {{ previewPlaying ? "❚❚" : "▶" }}
                </button>
                <span class="clock mono">{{ formatDuration(previewPosSec) ?? "0:00" }}</span>
                <input
                  class="preview-seek"
                  type="range"
                  min="0"
                  :max="previewDurSec || 0"
                  step="0.01"
                  :value="previewPosSec"
                  aria-label="Seek in the preview"
                  @input="seekPreview(($event.target as HTMLInputElement).value)"
                />
                <span class="clock mono">{{ formatDuration(previewDurSec) ?? "0:00" }}</span>
              </div>

              <!-- One bar for both render paths, with the live stage under it. -->
              <div
                v-if="progress"
                class="progress"
                role="progressbar"
                :aria-valuenow="Math.round(progress.fraction * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div class="progress-track">
                  <div class="progress-fill" :style="{ width: `${progress.fraction * 100}%` }" />
                </div>
                <p class="progress-label mono">{{ progress.label }}</p>
              </div>

              <p v-if="!hasProgramme" class="review-head mono">
                Every region is rejected or muted — there is nothing to render.
              </p>
              <p v-if="publishState === 'error'" class="error big-error" role="alert">
                <span class="error-mark" aria-hidden="true">⚠</span> {{ publishError }}
              </p>
              <p v-if="previewError" class="error big-error" role="alert">
                <span class="error-mark" aria-hidden="true">⚠</span> {{ previewError }}
              </p>
            </template>

            <!-- Published: this cut is spent. Offer a fresh session, never a second publish
                 of the same audio. Attached to a note, the recording is already where it
                 belongs; with no note picked there is still a link to paste. -->
            <div v-else class="published">
              <template v-if="attachedTo">
                <p class="mono done-label">Published.</p>
                <p class="attached-line">
                  Attached to
                  <a :href="attachedTo.url" target="_blank" rel="noopener">{{ attachedTo.title }}</a
                  >.
                </p>
                <div class="review-actions">
                  <button class="btn primary" @click="resetSession">Start a new recording</button>
                </div>
              </template>
              <template v-else>
                <p class="mono done-label">Published. Paste this into your note:</p>
                <textarea class="link-box mono" readonly :value="link" rows="2" />
                <div class="review-actions">
                  <button class="btn primary" @click="copyLink">
                    {{ copied ? "Copied ✓" : "Copy link" }}
                  </button>
                  <button class="btn" @click="resetSession">Start a new recording</button>
                </div>
              </template>
            </div>
          </div>
        </template>
      </template>

      <RouterLink to="/" class="page-back">← Back to the ode</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.page {
  padding: 4rem 2rem 3rem;
}
.page-inner {
  max-width: 720px;
  margin: 0 auto;
}
.mono {
  font-family: var(--hw-mono);
}
.eyebrow {
  margin-bottom: 1.25rem;
  color: var(--hw-pink-deep);
}
.page-title {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.08;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 1.5rem;
  text-wrap: balance;
}
.page-note {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: var(--hw-surface);
  padding: 1.1rem 1.3rem;
  margin: 0 0 2rem;
}
.page-note p {
  margin: 0;
  color: var(--hw-ink-soft);
  line-height: 1.55;
}
.page-note.danger {
  border-color: #c0392b;
}
.status-line {
  color: var(--hw-ink-faint);
}
.signed-in {
  color: var(--hw-ink-soft);
  margin: 0 0 1.5rem;
}
.signed-in .mono {
  color: var(--hw-pink-deep);
}
/* Title and note picker read as one decision, so they share a box. */
.target {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  padding: 1.25rem;
  margin: 0 0 2rem;
}
.field {
  display: block;
  margin: 0 0 1.5rem;
}
.target .field {
  margin-bottom: 1.1rem;
}
.field-label {
  display: block;
  font-size: 0.85rem;
  color: var(--hw-ink-faint);
  margin-bottom: 0.35rem;
}
.field-input {
  width: 100%;
  padding: 0.5rem 0.65rem;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  background: var(--hw-surface);
  font-family: var(--hw-serif);
  color: var(--hw-ink);
}
.recorder {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  padding: 1.25rem;
  margin: 0 0 2rem;
}
.mic-row {
  margin-bottom: 1rem;
}
.levels {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 3rem;
  margin: 0.5rem 0 1rem;
}
.bar {
  flex: 1;
  min-width: 2px;
  border-radius: 1px;
  background: var(--link-accent);
  transition: height 60ms linear;
}
.transport {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.elapsed {
  font-size: 1.1rem;
  min-width: 3.5rem;
}
.flag-count {
  color: var(--hw-ink-faint);
  font-size: 0.85rem;
}
.btn {
  padding: 0.4rem 0.8rem;
  font-family: var(--hw-mono);
  font-size: 0.85rem;
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
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  background: var(--hw-pink);
  border-color: var(--hw-pink);
  color: var(--hw-surface);
}
.btn.primary:hover:not(:disabled) {
  background: var(--hw-pink-deep);
  color: var(--hw-surface);
}
.review {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  padding: 1.25rem;
  margin: 0 0 2rem;
  background: var(--hw-surface);
}
.review-head {
  margin: 0 0 0.75rem;
  color: var(--hw-ink-faint);
}
.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--hw-ink-soft);
  margin-bottom: 1rem;
}
.review-actions {
  display: flex;
  gap: 0.6rem;
}
.published {
  margin-top: 1.25rem;
}
.done-label {
  color: var(--hw-ink-faint);
  font-size: 0.8rem;
  margin: 0 0 0.4rem;
}
.attached-line {
  margin: 0 0 1rem;
  color: var(--hw-ink-soft);
}
.attached-line a {
  color: var(--hw-pink-deep);
}
.link-box {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--hw-rule);
  border-radius: 4px;
  background: var(--hw-pink-wash);
  color: var(--hw-ink);
  resize: vertical;
  margin-bottom: 0.5rem;
}
.error {
  color: #c0392b;
  font-size: 0.9rem;
  margin: 0.75rem 0 0;
}
.preview-hint {
  font-size: 0.78rem;
  color: var(--hw-ink-faint);
  margin: 0.6rem 0 0;
}
.preview-player {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin: 0.8rem 0 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: var(--hw-pink-wash);
}
.clock {
  min-width: 3.2rem;
  font-size: 0.85rem;
  color: var(--hw-ink-soft);
}
.preview-seek {
  flex: 1;
  min-width: 8rem;
  accent-color: var(--hw-pink);
  cursor: pointer;
}
.offstage {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
}
.progress {
  margin: 0.9rem 0 0;
}
.progress-track {
  height: 8px;
  border-radius: 4px;
  background: var(--hw-pink-wash);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--hw-pink);
  border-radius: 4px;
  transition: width 200ms ease;
}
.progress-label {
  font-size: 0.78rem;
  color: var(--hw-ink-faint);
  margin: 0.35rem 0 0;
}
/* An error the author must not miss: boxed, ink on a wash, not a thin grey line. */
.big-error {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.95rem;
  font-weight: 500;
  border: 1px solid #c0392b;
  border-radius: 6px;
  background: rgba(192, 57, 43, 0.08);
  padding: 0.7rem 0.9rem;
  margin-top: 0.9rem;
}
.error-mark {
  font-size: 1.05rem;
}
.notes {
  margin: 0;
}
.notes-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.6rem;
}
.notes-head .hw-label {
  margin: 0;
}
/* A button that has to read as an aside, not a third action competing with Record. */
.link-btn {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.8rem;
  color: var(--link-accent);
  text-decoration: underline;
}
.link-btn:hover {
  color: var(--hw-pink-deep);
}
.note-filter {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
}
.note-list {
  list-style: none;
  /* A long PDS scrolls inside the list instead of burying the recorder below it. Roughly
     seven rows tall; the inline padding keeps focus rings off the scroll edge. */
  max-height: 14rem;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 0 0.15rem;
  margin: 0.5rem 0 0;
}
.note-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0.5rem;
  border-bottom: 1px solid var(--hw-rule);
}
.note-item.picked {
  background: var(--hw-pink-wash);
  border-radius: 3px;
}
.note-item.picked .note-pick {
  color: var(--hw-pink-deep);
}
.note-pick {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--hw-serif);
  font-size: 1rem;
  color: var(--hw-ink);
  padding: 0;
}
.note-pick:hover {
  color: var(--hw-pink-deep);
}
.note-pick:focus-visible {
  outline: 2px solid var(--hw-pink);
  outline-offset: 2px;
  border-radius: 2px;
}
/* Deliberately not named after DaisyUI's pill component. That name is a live component
   class, so these spans were painted as a full pill — border, padding, and a
   background-color off --color-base-100 — on top of the two declarations below. Under the
   dark theme that base flipped to navy while the glyph kept its hardcoded dark ink, and
   the dash vanished. The name is spelled out nowhere here on purpose: Tailwind scans this
   file as raw text, so writing it even inside a comment re-emits the dead component rule
   (the same doc-scanning trap that src/style.css uses `source(none)` to avoid). */
.audio-flag {
  /* --hw-pink-deep is raw editorial pink: ~4.8:1 on a plain row but ~3.9:1 over the
     pink-wash of a picked row — under AA, and this glyph carries meaning. --link-accent
     re-pins the same hue to a fixed lightness (~7:1 on rows, ~5.8:1 on pink-wash). */
  color: var(--link-accent);
  font-size: 0.9rem;
}
/* The "no audio" dash must still read under a browser-forced dark mode (Dark Reader /
   Chrome auto-dark). Mid-greys like ink-soft/ink-faint invert to mid-greys and collapse
   to ~2:1 on the inverted-dark row. Full ink is an extreme luminance, so it inverts to a
   near-white that stays legible either way. */
.audio-flag-mute {
  color: var(--hw-ink);
}
/* The arrow off to the row's edge: reachable, never louder than the title it follows. */
.note-open {
  color: var(--link-accent);
  font-size: 0.85rem;
  text-decoration: none;
  padding: 0 0.15rem;
}
.note-open:hover {
  color: var(--hw-pink-deep);
}
.note-open:focus-visible {
  outline: 2px solid var(--hw-pink);
  outline-offset: 2px;
  border-radius: 2px;
}
.picked-link {
  color: inherit;
}
.picked-line {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--hw-pink-deep);
  margin: 0.6rem 0 0;
}
.hint {
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
  margin-top: 0.75rem;
}
.page-back {
  color: var(--hw-ink-faint);
  text-decoration: none;
  font-size: 0.95rem;
}
.page-back:hover {
  color: var(--hw-pink-deep);
}
@media (max-width: 640px) {
  .page {
    padding: 3rem 1.25rem 2.5rem;
  }
}
</style>
