import { ref } from "vue"

// vite-plugin-pwa generates `virtual:pwa-register/vue` at build time, so it does not exist
// under vitest. Aliased in vitest.config.ts; specs import these refs to drive the toast.
export const offlineReady = ref(false)
export const needRefresh = ref(false)
export const updateServiceWorker = () => Promise.resolve()

export const useRegisterSW = () => ({ offlineReady, needRefresh, updateServiceWorker })
