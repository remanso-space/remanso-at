import { renderSession } from "./assemble"
import type { RenderRequest, RenderResponse } from "./renderInWorker"

// The render is pure number-crunching over Float32Arrays — assemble, chain DSP, brick
// limit — and on a long programme it blocks the main thread for long enough to freeze the
// UI. Moving it here keeps the tab responsive while it runs. The client (renderInWorker)
// copies the PCM in (the main thread still owns those buffers for playback), and we transfer
// the finished samples back out so the sum is never copied twice.

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { session, takePcm, sampleRate, cuePcm } = e.data
  const rendered = renderSession(session, takePcm, sampleRate, cuePcm)
  const message: RenderResponse = { ok: true, rendered }
  // Only the output buffer is transferred; the inputs were copied in and belong to the caller.
  ;(self as unknown as Worker).postMessage(message, [rendered.samples.buffer])
}
