<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { RouterLink, useRoute } from "vue-router"

import { useSession } from "../composables/useSession"
import { listAllRecordings } from "../modules/atproto/listAllRecordings"
import { listRecordings, type ListenRecording } from "../modules/atproto/listRecordings"
import { formatDuration } from "../utils/formatDuration"

// Two scopes. A single repo is read straight from its PDS: `?handle=` or `?did=` picks
// whose, and signed in with neither picks your own. With no repo in focus — signed out with
// no handle, or an explicit `?all=1` — the everyone feed comes from the appview, the only
// place that has seen every author's recordings.
const route = useRoute()
const { did, handle, isLoggedIn } = useSession()

const wantsEveryone = computed(() => route.query.all === "1")

const requested = computed(() => {
  const fromQuery = route.query.handle ?? route.query.did
  const asked = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery
  const trimmed = asked?.trim()
  if (trimmed) return trimmed
  if (wantsEveryone.value) return ""
  return did.value || ""
})

const mode = computed<"everyone" | "repo">(() => (requested.value ? "repo" : "everyone"))
const isOwnRepo = computed(() => !!did.value && requested.value === did.value)

const recordings = ref<ListenRecording[]>([])
const cursor = ref<string | undefined>(undefined)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
const shownHandle = ref<string | null>(null)

// A monotonic token: a slower earlier load must never overwrite a newer scope's results,
// and the everyone feed has no actor to compare, so a counter covers both scopes.
let loadSeq = 0

const detailOf = (result: { detail?: string }) => result.detail

const errorFor = (reason: string, detail?: string) =>
  reason === "unresolved-actor"
    ? `Could not find a repo for "${requested.value}". Check the handle, or that its PDS is reachable.`
    : `Could not read the recordings (${reason}${detail ? `: ${detail}` : ""}).`

const load = async () => {
  const seq = ++loadSeq
  loading.value = true
  error.value = null

  if (mode.value === "everyone") {
    const result = await listAllRecordings()
    if (seq !== loadSeq) return
    loading.value = false
    if (!result.ok) {
      recordings.value = []
      cursor.value = undefined
      error.value = errorFor(result.reason, detailOf(result))
      return
    }
    recordings.value = result.recordings
    cursor.value = result.cursor
    shownHandle.value = null
    return
  }

  const result = await listRecordings({ actor: requested.value })
  if (seq !== loadSeq) return
  loading.value = false
  if (!result.ok) {
    recordings.value = []
    cursor.value = undefined
    error.value = errorFor(result.reason, detailOf(result))
    return
  }
  recordings.value = result.recordings
  cursor.value = result.cursor
  shownHandle.value = result.actor.handle
}

const loadMore = async () => {
  if (!cursor.value || loadingMore.value) return
  loadingMore.value = true
  const result =
    mode.value === "everyone"
      ? await listAllRecordings({ cursor: cursor.value })
      : await listRecordings({ actor: requested.value, cursor: cursor.value })
  loadingMore.value = false
  if (!result.ok) {
    error.value = errorFor(result.reason, detailOf(result))
    return
  }
  recordings.value = [...recordings.value, ...result.recordings]
  cursor.value = result.cursor
}

onMounted(() => void load())

watch([requested, wantsEveryone], () => {
  recordings.value = []
  cursor.value = undefined
  shownHandle.value = null
  void load()
})

const whose = computed(() => {
  if (mode.value === "everyone") return "everyone"
  if (isOwnRepo.value) return "yours"
  return shownHandle.value || requested.value
})

const publishedOn = (recording: ListenRecording) => {
  const stamp = recording.value.recordedAt ?? recording.value.createdAt
  if (!stamp) return null
  const date = new Date(stamp)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
}

const titleOf = (recording: ListenRecording) =>
  recording.value.title || recording.note?.title || "Untitled recording"
</script>

<template>
  <section class="page">
    <div class="page-inner">
      <p class="hw-label eyebrow">§ — listen</p>
      <h1 v-if="mode === 'everyone'" class="page-title">
        Every recording, from every repo that publishes one.
      </h1>
      <h1 v-else class="page-title">Recordings, straight from the PDS that holds them.</h1>

      <p v-if="mode === 'everyone'" class="page-lede">
        Every <code class="mono">space.remanso.recording</code> the
        <a href="https://api.remanso.space">appview</a> has indexed, newest first, read with no
        account needed. Each plays from the author's own PDS. Add
        <code class="mono">?handle=you.example.com</code> to read a single repo instead.
      </p>
      <p v-else class="page-lede">
        Every <code class="mono">space.remanso.recording</code> in one repo, newest first, read with
        no account needed. Each one keeps a link back to its note on
        <a href="https://remanso.space">remanso.space</a>, which stays home for the writing.
      </p>

      <template>
        <p class="whose mono">
          {{ whose
          }}<span v-if="recordings.length">
            — {{ recordings.length }} recording{{ recordings.length === 1 ? "" : "s" }}</span
          >
        </p>

        <div v-if="error" class="page-note error">
          <p>{{ error }}</p>
        </div>

        <p v-if="loading" class="status-line">
          {{ mode === "everyone" ? "Loading recordings…" : "Reading the repo…" }}
        </p>

        <div v-else-if="!recordings.length && !error" class="page-note">
          <p v-if="mode === 'everyone'">
            No recordings indexed yet. Publish a cut from
            <RouterLink to="/studio">the studio</RouterLink> and it shows up here.
          </p>
          <p v-else-if="isOwnRepo">
            Nothing in your recording collection yet. Publish a cut from
            <RouterLink to="/studio">the studio</RouterLink> and it shows up here.
          </p>
          <p v-else>This repo holds no recordings.</p>
        </div>

        <ol v-if="recordings.length" class="takes">
          <li v-for="recording in recordings" :key="recording.uri" class="take">
            <div class="take-head">
              <h2 class="take-title">{{ titleOf(recording) }}</h2>
              <span v-if="formatDuration(recording.value.durationSec)" class="take-len mono">
                {{ formatDuration(recording.value.durationSec) }}
              </span>
            </div>

            <p class="take-meta mono">
              <span v-if="publishedOn(recording)">{{ publishedOn(recording) }}</span>
              <a v-if="recording.note" :href="recording.note.url" class="take-note"> the note ↗ </a>
            </p>

            <audio class="take-audio" controls preload="none" :src="recording.audioUrl"></audio>

            <details v-if="recording.value.credits?.length" class="take-credits">
              <summary>Music credits</summary>
              <ul>
                <li v-for="credit in recording.value.credits" :key="credit.sourceUrl">
                  <a :href="credit.sourceUrl">{{ credit.title }}</a> by {{ credit.creator }} —
                  <a :href="credit.licenseUrl">{{ credit.license }}</a>
                </li>
              </ul>
            </details>
          </li>
        </ol>

        <button v-if="cursor" class="more" type="button" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? "Loading…" : "Load older recordings" }}
        </button>
      </template>

      <nav class="scope-links">
        <RouterLink v-if="mode !== 'everyone'" :to="{ path: '/listen', query: { all: '1' } }">
          Everyone's recordings
        </RouterLink>
        <RouterLink v-if="isLoggedIn && !isOwnRepo" :to="{ path: '/listen', query: { did } }">
          Your own recordings{{ handle ? ` (${handle})` : "" }}
        </RouterLink>
      </nav>

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

.page-lede {
  font-size: 1.18rem;
  line-height: 1.6;
  color: var(--hw-ink-soft);
  margin: 0 0 1.75rem;
  text-wrap: pretty;
}

.page-lede code,
.page-note code {
  font-family: var(--hw-mono);
  font-size: 0.85em;
  background: var(--hw-pink-wash);
  color: var(--hw-pink-deep);
  padding: 0.05em 0.35em;
  border-radius: 3px;
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

.page-note.error {
  border-color: var(--hw-pink-deep);
}

.whose {
  font-size: 0.85rem;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  color: var(--hw-ink-faint);
  margin: 0 0 1rem;
}

.status-line {
  color: var(--hw-ink-faint);
  margin: 0 0 2rem;
}

.takes {
  list-style: none;
  padding: 0;
  margin: 0 0 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.take {
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: var(--hw-surface);
  padding: 1.1rem 1.3rem;
}

.take-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.take-title {
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0;
  text-wrap: pretty;
}

.take-len {
  font-size: 0.85rem;
  color: var(--hw-ink-faint);
  white-space: nowrap;
}

.take-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--hw-ink-faint);
  margin: 0.35rem 0 0.85rem;
}

.take-note {
  color: var(--hw-pink-deep);
  text-decoration: none;
}

.take-note:hover {
  text-decoration: underline;
}

.take-audio {
  width: 100%;
}

.take-credits {
  margin-top: 0.85rem;
  font-size: 0.9rem;
  color: var(--hw-ink-soft);
}

.take-credits summary {
  cursor: pointer;
  color: var(--hw-ink-faint);
}

.take-credits ul {
  margin: 0.5rem 0 0;
  padding-left: 1.1rem;
  line-height: 1.5;
}

.more {
  font: inherit;
  font-size: 0.95rem;
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: transparent;
  color: var(--hw-ink-soft);
  padding: 0.55rem 1.1rem;
  cursor: pointer;
  margin: 0 0 2rem;
}

.more:hover:not(:disabled) {
  border-color: var(--hw-pink-deep);
  color: var(--hw-pink-deep);
}

.more:disabled {
  cursor: default;
  opacity: 0.6;
}

.scope-links {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin: 0 0 1.5rem;
  font-size: 0.95rem;
}

.scope-links a {
  color: var(--hw-pink-deep);
  text-decoration: none;
}

.scope-links a:hover {
  text-decoration: underline;
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
