import { createLoudnessEstimator } from "../../utils/loudness"
import { decodeTakeToMono } from "./mediaCodec"
import { computePeaks, PEAKS_BINS_PER_SEC, type Peaks } from "./peaks"
import { detectSilences, planCuts, speechOnsets, type Cut, type Silence } from "./pauses"

// One decode, every overlay: peaks, pause candidates, onsets and loudness all fall out of
// the same mono buffer, and keeping the samples means publish does not decode again.
//
// The measured LUFS is the *raw* take, before the chain — it answers "was the mic level
// sane", not "what will the episode be". The render normalises to -16 regardless.

/** The window BS.1770 gates on. 400 ms is the spec's momentary block. */
const LOUDNESS_WINDOW_SEC = 0.4

export interface TakeAnalysis {
  peaks: Peaks
  silences: Silence[]
  /** Pause-removal candidates, in take seconds. Proposed, never applied automatically. */
  cuts: Cut[]
  onsets: number[]
  lufs: number | null
}

export const analyzeDecoded = (
  samples: Float32Array,
  sampleRate: number,
  binsPerSec = PEAKS_BINS_PER_SEC,
): TakeAnalysis => {
  const silences = detectSilences(samples, sampleRate)

  const estimator = createLoudnessEstimator(sampleRate)
  const window = Math.max(1, Math.round(LOUDNESS_WINDOW_SEC * sampleRate))
  for (let start = 0; start < samples.length; start += window) {
    estimator.push(samples.subarray(start, Math.min(start + window, samples.length)))
  }

  return {
    peaks: computePeaks(samples, sampleRate, binsPerSec),
    silences,
    cuts: planCuts(silences),
    onsets: speechOnsets(samples, sampleRate),
    lufs: estimator.lufs(),
  }
}

export interface AnalyzedTake extends TakeAnalysis {
  samples: Float32Array
  durationSec: number
}

/**
 * Duration comes from the sample count, not the container's header: the EDL indexes into
 * these samples, and a clip window off by a few frames would render silence at the seam.
 */
export const analyzeTakeFile = async (
  file: File,
  sampleRate: number,
): Promise<AnalyzedTake | null> => {
  const decoded = await decodeTakeToMono(file, sampleRate)
  if (!decoded) return null
  const durationSec = decoded.samples.length / sampleRate
  return { samples: decoded.samples, durationSec, ...analyzeDecoded(decoded.samples, sampleRate) }
}
