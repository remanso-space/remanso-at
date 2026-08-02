<script setup lang="ts">
import { onMounted, ref, watch } from "vue"

import { useSession } from "../composables/useSession"
import { useTakeRecorder } from "../composables/useTakeRecorder"
import {
  listPublishedNotes,
  recordingAltFor,
  type PublishedNote,
} from "../modules/atproto/publishedNotes"
import type { Take } from "../modules/studio/edl.types"
import { canEncodeOpus } from "../modules/studio/mediaCodec"
import { publishTake } from "../modules/studio/publishTake"
import { formatDuration } from "../utils/formatDuration"

const { isLoggedIn, handle, did } = useSession()
const recorder = useTakeRecorder()

type Gate = "checking" | "ok" | "unsupported"
const gate = ref<Gate>("checking")

const notes = ref<PublishedNote[]>([])
const notesError = ref<string | null>(null)
const loadingNotes = ref(false)

const title = ref("")
const take = ref<Take | null>(null)
const removePauses = ref(true)

type PublishState = "idle" | "publishing" | "done" | "error"
const publishState = ref<PublishState>("idle")
const link = ref("")
const publishError = ref<string | null>(null)
const copied = ref(false)

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

const pickNote = (note: PublishedNote) => {
  title.value = note.record.value.title
}

const startRecording = async () => {
  take.value = null
  publishState.value = "idle"
  link.value = ""
  await recorder.start()
}

const stopRecording = async () => {
  take.value = await recorder.stop()
}

const discardTake = async () => {
  if (take.value)
    await import("../modules/studio/opfsTakes").then((m) => m.deleteTake(take.value!.opfsPath))
  take.value = null
}

const publish = async () => {
  if (!take.value || !did.value) return
  publishState.value = "publishing"
  publishError.value = null
  const result = await publishTake({
    did: did.value,
    take: take.value,
    title: title.value || "Untitled",
    removePauses: removePauses.value,
  })
  if (result.ok) {
    link.value = result.link
    publishState.value = "done"
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
        <p v-if="gate === 'checking'" class="status">Checking audio support…</p>

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
                <button class="btn primary" @click="startRecording">Record</button>
              </template>
              <template v-else>
                <button class="btn" @click="recorder.flag('mark')">Flag ▹</button>
                <button class="btn" @click="recorder.flag('retake')">Bad take ✕</button>
                <button class="btn primary" @click="stopRecording">Stop</button>
                <span class="flag-count mono">{{ recorder.flags.value.length }} flags</span>
              </template>
            </div>

            <p v-if="recorder.error.value" class="error">{{ recorder.error.value }}</p>
          </div>

          <!-- Review + publish -->
          <div v-if="take" class="review">
            <p class="review-head mono">
              Take: {{ formatDuration(take.durationSec) }} · {{ take.flags.length }} flags
            </p>
            <label class="check">
              <input v-model="removePauses" type="checkbox" />
              Trim head/tail and remove long pauses
            </label>

            <div class="review-actions">
              <button
                class="btn primary"
                :disabled="publishState === 'publishing'"
                @click="publish"
              >
                {{ publishState === "publishing" ? "Rendering…" : "Render & publish" }}
              </button>
              <button class="btn" :disabled="publishState === 'publishing'" @click="discardTake">
                Discard
              </button>
            </div>

            <p v-if="publishState === 'error'" class="error">{{ publishError }}</p>

            <div v-if="publishState === 'done'" class="published">
              <p class="mono done-label">Published. Paste this into your note:</p>
              <textarea class="link-box mono" readonly :value="link" rows="2" />
              <button class="btn" @click="copyLink">{{ copied ? "Copied ✓" : "Copy link" }}</button>
            </div>
          </div>

          <!-- Your published notes: pick one to record against -->
          <div class="notes">
            <p class="hw-label">§ — your notes</p>
            <p v-if="loadingNotes" class="status">Loading…</p>
            <p v-else-if="notesError" class="error">{{ notesError }}</p>
            <ul v-else-if="notes.length" class="note-list">
              <li v-for="n in notes" :key="n.record.uri" class="note-item">
                <button class="note-pick" @click="pickNote(n)">{{ n.record.value.title }}</button>
                <span v-if="n.hasAudio" class="badge mono" title="Already has audio">♪</span>
                <span v-else class="badge badge-mute mono" title="No audio yet">—</span>
              </li>
            </ul>
            <p v-else class="status">No published notes found on your PDS.</p>
            <p class="hint">
              Picking a note prefills the title; the link pastes as {{ recordingAltFor("title") }}.
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
  border-left: 3px solid #c0392b;
}
.status {
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
  padding: 0;
  margin: 0.5rem 0 0;
}
.note-item {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--hw-rule);
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
.badge {
  color: var(--hw-pink-deep);
  font-size: 0.9rem;
}
.badge-mute {
  color: var(--hw-ink-faint);
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
