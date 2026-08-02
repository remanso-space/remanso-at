<script setup lang="ts">
import { useRegisterSW } from "virtual:pwa-register/vue"

import { useRecordingState } from "../composables/useRecordingState"

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()
// An update dialog mid-recording is hostile — hold the toast until the take is done.
const { isRecording } = useRecordingState()

const close = () => {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <Teleport to="body">
    <div v-if="(offlineReady || needRefresh) && !isRecording" role="alert" class="toast">
      <p class="toast-label mono">{{ offlineReady ? "offline ready" : "new version" }}</p>
      <p class="toast-body">
        {{ offlineReady ? "Ready to work offline." : "A fresh build is available." }}
      </p>
      <div class="toast-actions">
        <button
          v-if="needRefresh"
          class="toast-btn toast-btn-primary"
          @click="updateServiceWorker()"
        >
          Reload
        </button>
        <button class="toast-btn" @click="close">Close</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toast {
  position: fixed;
  right: 1.5rem;
  bottom: 1.5rem;
  width: 15rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--hw-rule);
  border-left: 3px solid var(--hw-pink);
  background: var(--hw-surface);
  box-shadow: 0 8px 24px rgba(31, 27, 24, 0.1);
  font-family: var(--hw-serif);
  color: var(--hw-ink);
}

.toast-label {
  margin: 0;
  font-family: var(--hw-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--hw-ink-faint);
}

.toast-body {
  margin: 0.35rem 0 0;
  font-size: 0.95rem;
  line-height: 1.4;
}

.toast-actions {
  margin-top: 0.85rem;
  display: flex;
  gap: 0.5rem;
}

.toast-btn {
  flex: 1;
  padding: 0.35rem 0.5rem;
  font-family: var(--hw-mono);
  font-size: 0.8rem;
  cursor: pointer;
  border: 1px solid var(--hw-rule);
  background: transparent;
  color: var(--hw-ink-soft);
}

.toast-btn:hover {
  color: var(--hw-pink-deep);
  border-color: var(--hw-pink);
}

.toast-btn-primary {
  background: var(--hw-pink);
  border-color: var(--hw-pink);
  color: var(--hw-surface);
}

.toast-btn-primary:hover {
  background: var(--hw-pink-deep);
  border-color: var(--hw-pink-deep);
  color: var(--hw-surface);
}
</style>
