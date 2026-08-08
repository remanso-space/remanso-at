import { renderSession } from "./assemble"
import type { RenderRequest, RenderResponse } from "./renderInWorker"

// A long programme blocks the main thread long enough to freeze the UI, so the crunch runs
// here instead.

self.onmessage = (e: MessageEvent<RenderRequest>) => {
  const { session, takePcm, sampleRate, cuePcm } = e.data
  const rendered = renderSession(session, takePcm, sampleRate, cuePcm)
  const message: RenderResponse = { ok: true, rendered }
  // Only the output buffer is transferred; the inputs were copied in and belong to the caller.
  ;(self as unknown as Worker).postMessage(message, [rendered.samples.buffer])
}
