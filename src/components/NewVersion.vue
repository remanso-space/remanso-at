<script setup lang="ts">
import { useRegisterSW } from "virtual:pwa-register/vue"

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW()

const close = () => {
  offlineReady.value = false
  needRefresh.value = false
}
</script>

<template>
  <div
    v-if="offlineReady || needRefresh"
    role="alert"
    class="fixed right-4 bottom-4 w-56 border border-primary bg-base-100 p-3 text-sm"
  >
    <p v-if="offlineReady">Ready to work offline.</p>
    <p v-else>New version available.</p>
    <div class="mt-3 flex gap-2">
      <button
        v-if="needRefresh"
        class="btn btn-primary btn-sm flex-1"
        @click="updateServiceWorker()"
      >
        Reload
      </button>
      <button class="btn btn-sm flex-1" @click="close">Close</button>
    </div>
  </div>
</template>
