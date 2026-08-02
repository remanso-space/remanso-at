import { readonly, ref } from "vue"

// A single module-level flag so the NewVersion update toast can suppress itself while a
// take is recording — an update dialog mid-recording is hostile (plan / slice-0 note).
// The recorder sets it; NewVersion reads it.
const recording = ref(false)

export const useRecordingState = () => ({
  isRecording: readonly(recording),
  setRecording: (value: boolean) => {
    recording.value = value
  },
})
