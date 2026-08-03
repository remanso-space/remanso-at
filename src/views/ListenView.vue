<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue"
import { RouterLink, useRoute, useRouter } from "vue-router"

import { useSession } from "../composables/useSession"
import { deleteRecording } from "../modules/atproto/deleteRecording"
import { listAllRecordings } from "../modules/atproto/listAllRecordings"
import { listRecordings, type ListenRecording } from "../modules/atproto/listRecordings"
import { searchActors, type ActorSuggestion } from "../modules/atproto/searchActors"
import { formatDuration } from "../utils/formatDuration"

// Two scopes. A single repo is read straight from its PDS: `?handle=` or `?did=` picks
// whose, and signed in with neither picks your own. With no repo in focus — signed out with
// no handle, or an explicit `?all=1` — the everyone feed comes from the appview, the only
// place that has seen every author's recordings.
const route = useRoute()
const router = useRouter()
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

// The search box. Suggestions come from the network — the public appview's typeahead over
// every atproto handle — so someone else's recordings are findable without knowing their
// handle by heart. A free-typed handle still works: the list is a shortcut, not a gate.
const SUGGEST_DEBOUNCE_MS = 180

const search = ref("")
const suggestions = ref<ActorSuggestion[]>([])
const suggestOpen = ref(false)
const activeIndex = ref(-1)

let suggestTimer: ReturnType<typeof setTimeout> | undefined
let suggestAbort: AbortController | undefined
// The box is written to programmatically too (seeded from the repo in focus); only a real
// keystroke should reopen the list, so suggesting is driven from the input event.
const runSuggest = async (query: string) => {
  suggestAbort?.abort()
  const controller = new AbortController()
  suggestAbort = controller

  const found = await searchActors(query, { signal: controller.signal })
  if (controller.signal.aborted) return
  suggestions.value = found
  suggestOpen.value = found.length > 0
  activeIndex.value = -1
}

const onSearchInput = () => {
  const query = search.value.trim()
  clearTimeout(suggestTimer)

  if (!query) {
    suggestAbort?.abort()
    suggestions.value = []
    suggestOpen.value = false
    activeIndex.value = -1
    return
  }
  suggestTimer = setTimeout(() => void runSuggest(query), SUGGEST_DEBOUNCE_MS)
}

const closeSuggestions = () => {
  suggestOpen.value = false
  activeIndex.value = -1
}

const goToHandle = (asked: string) => {
  clearTimeout(suggestTimer)
  suggestAbort?.abort()
  closeSuggestions()
  void router.push(
    asked
      ? { path: "/listen", query: { handle: asked } }
      : { path: "/listen", query: { all: "1" } },
  )
}

const pick = (suggestion: ActorSuggestion) => {
  search.value = suggestion.handle
  goToHandle(suggestion.handle)
}

// Enter with a highlighted row takes that row; with none it takes what is typed, so a handle
// the appview has never indexed is still reachable.
const submitSearch = () => {
  const highlighted = suggestOpen.value ? suggestions.value[activeIndex.value] : undefined
  if (highlighted) {
    pick(highlighted)
    return
  }
  goToHandle(search.value.trim())
}

// Arrows cycle through the rows and back out to "nothing highlighted", so holding ArrowUp
// returns you to what you typed instead of trapping you in the list. Slot 0 is that
// no-selection state, slots 1..n are the rows.
const moveActive = (step: number) => {
  if (!suggestions.value.length) return
  if (!suggestOpen.value) {
    suggestOpen.value = true
    return
  }
  const slots = suggestions.value.length + 1
  activeIndex.value = ((activeIndex.value + 1 + step + slots) % slots) - 1
}

onUnmounted(() => {
  clearTimeout(suggestTimer)
  suggestAbort?.abort()
})

// A monotonic token: a slower earlier load must never overwrite a newer scope's results,
// and the everyone feed has no actor to compare, so a counter covers both scopes.
let loadSeq = 0

const detailOf = (result: { detail?: string }) => result.detail

const errorFor = (reason: string, detail?: string) =>
  reason === "unresolved-actor"
    ? `Could not find anyone at "${requested.value}". Check the handle for a typo.`
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

const syncSearch = () => {
  // Show the handle in focus, not the raw DID — a repo opened by ?did= still reads back as
  // its handle once resolved. The everyone feed leaves the box empty.
  search.value = mode.value === "repo" ? (shownHandle.value ?? requested.value) : ""
  suggestions.value = []
  closeSuggestions()
}

onMounted(async () => {
  await load()
  syncSearch()
})

watch([requested, wantsEveryone], async () => {
  recordings.value = []
  cursor.value = undefined
  shownHandle.value = null
  await load()
  syncSearch()
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

// Deleting your own recordings, with friction. deleteRecord only ever touches the caller's
// own repo, so the controls only render on your own recordings (`isOwnRepo`). The friction is
// a typed confirmation: opening the panel is not enough — you have to type "delete" before the
// permanent button unlocks, so a stray tap on a phone can't erase a take.
const CONFIRM_WORD = "delete"

const confirmingUri = ref<string | null>(null)
const confirmText = ref("")
const deletingUri = ref<string | null>(null)
const deleteError = ref<string | null>(null)

const canConfirmDelete = computed(() => confirmText.value.trim().toLowerCase() === CONFIRM_WORD)

const startDelete = (uri: string) => {
  confirmingUri.value = uri
  confirmText.value = ""
  deleteError.value = null
}

const cancelDelete = () => {
  confirmingUri.value = null
  confirmText.value = ""
  deleteError.value = null
}

const confirmDelete = async (recording: ListenRecording) => {
  if (!canConfirmDelete.value || deletingUri.value) return
  deletingUri.value = recording.uri
  deleteError.value = null

  const result = await deleteRecording({ did: did.value ?? "", rkey: recording.rkey })
  deletingUri.value = null
  if (!result.ok) {
    deleteError.value =
      result.reason === "no-session"
        ? "You are signed out. Sign in again to delete this recording."
        : `Could not delete the recording (${result.reason}${
            "detail" in result ? `: ${result.detail}` : ""
          }).`
    return
  }

  recordings.value = recordings.value.filter((r) => r.uri !== recording.uri)
  cancelDelete()
}
</script>

<template>
  <section class="page">
    <div class="page-inner">
      <p class="hw-label eyebrow">§ — listen</p>
      <h1 v-if="mode === 'everyone'" class="page-title">
        Everything anyone has said out loud here.
      </h1>
      <h1 v-else class="page-title">Everything one person has said out loud.</h1>

      <p v-if="mode === 'everyone'" class="page-lede">
        Newest first, and no account needed to listen. The audio comes straight from the account of
        whoever recorded it. To follow one person, search their handle below.
      </p>
      <p v-else class="page-lede">
        Newest first, and no account needed to listen. Each one keeps a link back to the note it
        belongs to on <a href="https://remanso.space">remanso.space</a>, which stays home for the
        writing.
      </p>

      <form class="search" role="search" @submit.prevent="submitSearch">
        <div class="search-field">
          <input
            v-model="search"
            class="search-input mono"
            type="text"
            name="handle"
            placeholder="search a handle, e.g. you.example.com"
            aria-label="Search recordings by handle"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="handle-suggestions"
            :aria-expanded="suggestOpen"
            :aria-activedescendant="activeIndex >= 0 ? `suggestion-${activeIndex}` : undefined"
            autocapitalize="off"
            autocorrect="off"
            autocomplete="off"
            spellcheck="false"
            @input="onSearchInput"
            @keydown.down.prevent="moveActive(1)"
            @keydown.up.prevent="moveActive(-1)"
            @keydown.esc.prevent="closeSuggestions"
            @blur="closeSuggestions"
          />

          <ul
            v-if="suggestOpen"
            id="handle-suggestions"
            class="suggestions"
            role="listbox"
            aria-label="Matching handles"
          >
            <li
              v-for="(suggestion, index) in suggestions"
              :id="`suggestion-${index}`"
              :key="suggestion.did"
              class="suggestion"
              :class="{ active: index === activeIndex }"
              role="option"
              :aria-selected="index === activeIndex"
              @mousedown.prevent="pick(suggestion)"
              @mouseenter="activeIndex = index"
            >
              <img
                v-if="suggestion.avatar"
                class="suggestion-avatar"
                :src="suggestion.avatar"
                alt=""
                loading="lazy"
              />
              <span v-else class="suggestion-avatar placeholder" aria-hidden="true"></span>
              <span class="suggestion-text">
                <span class="suggestion-handle mono">{{ suggestion.handle }}</span>
                <span v-if="suggestion.displayName" class="suggestion-name">
                  {{ suggestion.displayName }}
                </span>
              </span>
            </li>
          </ul>
        </div>

        <button class="search-go" type="submit">Listen</button>
      </form>

      <p class="whose mono">
        {{ whose
        }}<span v-if="recordings.length">
          — {{ recordings.length }} recording{{ recordings.length === 1 ? "" : "s" }}</span
        >
      </p>

      <div v-if="error" class="page-note error">
        <p>{{ error }}</p>
      </div>

      <p v-if="loading" class="status-line">Loading recordings…</p>

      <div v-else-if="!recordings.length && !error" class="page-note">
        <p v-if="mode === 'everyone'">
          Nobody has published a recording yet. Make the first from
          <RouterLink to="/studio">the studio</RouterLink> and it shows up here.
        </p>
        <p v-else-if="isOwnRepo">
          You have not published a recording yet. Make one in
          <RouterLink to="/studio">the studio</RouterLink> and it shows up here.
        </p>
        <p v-else>Nothing recorded here yet.</p>
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

          <div v-if="isOwnRepo" class="take-delete">
            <button
              v-if="confirmingUri !== recording.uri"
              class="delete-open"
              type="button"
              @click="startDelete(recording.uri)"
            >
              Delete
            </button>

            <div v-else class="delete-confirm">
              <p class="delete-warn">
                This permanently removes “{{ titleOf(recording) }}” from your PDS. It cannot be
                undone. Type <code>{{ CONFIRM_WORD }}</code> to confirm.
              </p>
              <div class="delete-row">
                <input
                  v-model="confirmText"
                  class="delete-input mono"
                  type="text"
                  :placeholder="CONFIRM_WORD"
                  aria-label="Type delete to confirm"
                  autocapitalize="off"
                  autocorrect="off"
                  autocomplete="off"
                  spellcheck="false"
                  @keydown.enter.prevent="confirmDelete(recording)"
                />
                <button
                  class="delete-go"
                  type="button"
                  :disabled="!canConfirmDelete || deletingUri === recording.uri"
                  @click="confirmDelete(recording)"
                >
                  {{ deletingUri === recording.uri ? "Deleting…" : "Delete forever" }}
                </button>
                <button
                  class="delete-cancel"
                  type="button"
                  :disabled="deletingUri === recording.uri"
                  @click="cancelDelete"
                >
                  Cancel
                </button>
              </div>
              <p v-if="deleteError" class="delete-error">{{ deleteError }}</p>
            </div>
          </div>
        </li>
      </ol>

      <button v-if="cursor" class="more" type="button" :disabled="loadingMore" @click="loadMore">
        {{ loadingMore ? "Loading…" : "Load older recordings" }}
      </button>

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

/* --hw-rule (14% ink) is a hairline for card edges — 1.38:1 on white, far under the 3:1
   WCAG asks of a control's boundary, so it does not read as something you can type in.
   45% ink puts the border at 3.22:1. The fill is --link-accent rather than --hw-pink-deep
   (4.93:1 under white text) — style.css already pins it to 48% lightness, which lands
   white-on-accent at 7.18:1. */
.search {
  display: flex;
  gap: 0.6rem;
  margin: 0 0 2rem;
}

.search-field {
  position: relative;
  flex: 1;
  min-width: 0;
}

.search-input {
  width: 100%;
  box-sizing: border-box;
  font-size: 0.95rem;
  border: 1px solid color-mix(in oklch, var(--hw-ink) 45%, var(--hw-surface));
  border-radius: 6px;
  background: var(--hw-surface);
  color: var(--hw-ink);
  padding: 0.55rem 0.8rem;
}

.search-input::placeholder {
  color: var(--hw-ink-soft);
  opacity: 1;
}

.search-input:focus {
  outline: 2px solid var(--link-accent);
  outline-offset: 1px;
  border-color: var(--link-accent);
}

.suggestions {
  position: absolute;
  z-index: 20;
  top: calc(100% + 0.3rem);
  left: 0;
  right: 0;
  list-style: none;
  margin: 0;
  padding: 0.25rem;
  max-height: 17rem;
  overflow-y: auto;
  border: 1px solid color-mix(in oklch, var(--hw-ink) 45%, var(--hw-surface));
  border-radius: 6px;
  background: var(--hw-surface);
  box-shadow: 0 8px 24px color-mix(in oklch, var(--hw-ink) 18%, transparent);
}

.suggestion {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
}

.suggestion.active {
  background: var(--link-accent);
}

.suggestion-avatar {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  object-fit: cover;
  flex: none;
}

.suggestion-avatar.placeholder {
  background: var(--hw-pink-wash-2);
}

.suggestion-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.suggestion-handle {
  font-size: 0.9rem;
  color: var(--hw-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-name {
  font-size: 0.8rem;
  color: var(--hw-ink-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion.active .suggestion-handle,
.suggestion.active .suggestion-name {
  color: var(--hw-surface);
}

.search-go {
  font: inherit;
  font-size: 0.95rem;
  border: 1px solid var(--link-accent);
  border-radius: 6px;
  background: var(--link-accent);
  color: var(--hw-surface);
  padding: 0.55rem 1.2rem;
  cursor: pointer;
  white-space: nowrap;
}

.search-go:hover {
  background: color-mix(in oklch, var(--link-accent) 88%, var(--hw-ink));
  border-color: color-mix(in oklch, var(--link-accent) 88%, var(--hw-ink));
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

.take-delete {
  margin-top: 0.85rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--hw-rule);
}

.delete-open {
  font: inherit;
  font-size: 0.8rem;
  border: none;
  background: none;
  color: var(--hw-ink-faint);
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.delete-open:hover {
  color: var(--hw-pink-deep);
}

.delete-warn {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--hw-ink-soft);
  margin: 0 0 0.6rem;
}

.delete-warn code {
  font-family: var(--hw-mono);
  font-size: 0.85em;
  background: var(--hw-pink-wash);
  color: var(--hw-pink-deep);
  padding: 0.05em 0.35em;
  border-radius: 3px;
}

.delete-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

.delete-input {
  flex: 1;
  min-width: 8rem;
  font-size: 0.9rem;
  border: 1px solid color-mix(in oklch, var(--hw-ink) 38%, var(--hw-surface));
  border-radius: 6px;
  background: var(--hw-surface);
  color: var(--hw-ink);
  padding: 0.4rem 0.65rem;
}

.delete-input:focus {
  outline: 2px solid var(--hw-pink-deep);
  outline-offset: 1px;
  border-color: var(--hw-pink-deep);
}

.delete-go {
  font: inherit;
  font-size: 0.9rem;
  border: 1px solid var(--hw-pink-deep);
  border-radius: 6px;
  background: var(--hw-pink-deep);
  color: var(--hw-surface);
  padding: 0.4rem 0.9rem;
  cursor: pointer;
  white-space: nowrap;
}

.delete-go:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.delete-cancel {
  font: inherit;
  font-size: 0.9rem;
  border: 1px solid var(--hw-rule);
  border-radius: 6px;
  background: transparent;
  color: var(--hw-ink-soft);
  padding: 0.4rem 0.9rem;
  cursor: pointer;
}

.delete-cancel:hover:not(:disabled) {
  border-color: var(--hw-ink-faint);
}

.delete-error {
  font-size: 0.85rem;
  color: var(--hw-pink-deep);
  margin: 0.6rem 0 0;
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
