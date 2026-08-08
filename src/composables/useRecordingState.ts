import { readonly, ref } from "vue"

// A module-level flag so the NewVersion update toast suppresses itself while a take is
// recording. The recorder sets it; NewVersion reads it.
const recording = ref(false)

export const useRecordingState = () => ({
  isRecording: readonly(recording),
  setRecording: (value: boolean) => {
    recording.value = value
  },
})
