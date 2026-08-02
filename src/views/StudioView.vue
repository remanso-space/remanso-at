<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue"

import MusicSlotPanel from "../components/studio/MusicSlotPanel.vue"
import DerushPanel from "../components/studio/DerushPanel.vue"
import { useSession } from "../composables/useSession"
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
import { addTake, newSession } from "../modules/studio/edl"
import { programmeDurationSec } from "../modules/studio/musicSlots"
import type { Session } from "../modules/studio/edl.types"
import { SESSION_SAMPLE_RATE } from "../modules/studio/edl.types"
import { canUndo as historyCanUndo, commit, historyOf, undo } from "../modules/studio/history"
import { canEncodeOpus } from "../modules/studio/mediaCodec"
import { deletePeaks, writePeaks } from "../modules/studio/opfsPeaks"
import { deleteTake, readTakeFile } from "../modules/studio/opfsTakes"
import { publishSession } from "../modules/studio/publishSession"
import { formatDuration } from "../utils/formatDuration"

const { isLoggedIn, handle, did } = useSession()
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

// The title field sits far above the note list, so a pick has to report itself down here:
// the row stays marked and the confirmation line names what the title became.
const pickedUri = ref("")
const pickedNote = computed(() => notes.value.find((n) => n.record.uri === pickedUri.value))
const pickedTitle = computed(() => pickedNote.value?.record.value.title ?? "")

// remanso.space routes a public note at /pub/:shortDid/:rkey/:slug? — the slug is
// decorative, so the two-segment form is enough to land on the note.
const noteUrl = (did: string, rkey: string) =>
  `https://remanso.space/pub/${toShortDid(did)}/${rkey}`

const pickNote = (note: PublishedNote) => {
  title.value = note.record.value.title
  pickedUri.value = note.record.uri
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
    edit(addTake(session.value, take, `${take.id}:0`))
    selectedTakeId.value = take.id
    return
  }

  const { samples, durationSec, ...analysis } = analyzed
  takePcm[take.id] = samples
  analyses.value = { ...analyses.value, [take.id]: analysis }

  const peaksPath = await writePeaks(take.id, analysis.peaks).catch(() => "")
  edit(addTake(session.value, { ...take, durationSec, peaksPath }, `${take.id}:0`))
  selectedTakeId.value = take.id
}

/** Free every take's bytes and start from an empty EDL. */
const resetSession = async () => {
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

  publishState.value = "publishing"
  publishError.value = null
  const result = await publishSession({
    did: did.value,
    session: session.value,
    title: title.value || "Untitled",
    takePcm,
    noteRkey,
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

          <!-- Take title, prefilled from a picked note -->
          <label class="field">
            <span class="field-label">Episode title</span>
            <input v-model="title" class="field-input" placeholder="Untitled" />
          </label>

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

          <!-- Derush: the review pass over the EDL -->
          <DerushPanel
            v-if="session.takes.length && publishState !== 'done'"
            v-model:selected-take-id="selectedTakeId"
            :session="session"
            :analyses="analyses"
            :can-undo="canUndo"
            @edit="edit"
            @undo="history = undo(history)"
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
                  class="btn primary"
                  :disabled="publishState === 'publishing' || !hasProgramme"
                  @click="publish"
                >
                  {{ publishState === "publishing" ? "Rendering…" : "Render & publish" }}
                </button>
                <button class="btn" :disabled="publishState === 'publishing'" @click="resetSession">
                  Discard everything
                </button>
              </div>

              <p v-if="!hasProgramme" class="review-head mono">
                Every region is rejected or muted — there is nothing to render.
              </p>
              <p v-if="publishState === 'error'" class="error">{{ publishError }}</p>
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

          <!-- Your published notes: pick one to record against -->
          <div class="notes">
            <p class="hw-label">§ — your notes</p>
            <p v-if="loadingNotes" class="status-line">Loading…</p>
            <p v-else-if="notesError" class="error">{{ notesError }}</p>
            <ul v-else-if="notes.length" class="note-list">
              <li
                v-for="n in notes"
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
              </li>
            </ul>
            <p v-else class="status-line">No published notes found on your PDS.</p>
            <p v-if="pickedTitle" class="picked-line mono" role="status">
              Title set to “{{ pickedTitle }}”.
            </p>
            <p class="hint">
              Picking a note prefills the title and attaches the recording to that note. With no
              note picked you get {{ recordingAltFor("title") }} to paste instead.
            </p>
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
.field {
  display: block;
  margin: 0 0 1.5rem;
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
.notes {
  margin: 0 0 2rem;
}
.note-list {
  list-style: none;
  /* A long PDS scrolls inside the list instead of burying the rest of the page. Roughly ten
     rows tall; the inline padding keeps focus rings off the scroll edge. */
  max-height: 20rem;
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
.picked-line {
  font-size: 0.8rem;
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
