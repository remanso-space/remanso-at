import { renderSession, type CuePcm, type SessionRender, type TakePcm } from "./assemble"
import type { Session } from "./edl.types"

// The client half of the off-main-thread render. `renderSession` stays the pure, tested
// core; this wrapper runs it in a Worker when the platform has module workers, and falls
// straight back to a synchronous call when it does not (jsdom under test, or any browser
// without `type: "module"` workers). Same result either way — the Worker is a latency win,
// never a behaviour change.

export interface RenderRequest {
  session: Session
  takePcm: TakePcm
  sampleRate: number
  cuePcm: CuePcm
}

export type RenderResponse = { ok: true; rendered: SessionRender } | { ok: false; error: string }

const canUseModuleWorker = (): boolean => typeof Worker !== "undefined"

/**
 * Render off the main thread. The PCM maps are copied into the Worker (the main thread keeps
 * owning them for playback), and the finished samples are transferred back. On any Worker
 * failure — spawn, message or a thrown render — we fall back to the synchronous path so a
 * publish never dies on a Worker quirk.
 */
export const renderSessionInWorker = (
  session: Session,
  takePcm: TakePcm,
  sampleRate: number,
  cuePcm: CuePcm = {},
): Promise<SessionRender> => {
  if (!canUseModuleWorker()) {
    return Promise.resolve(renderSession(session, takePcm, sampleRate, cuePcm))
  }

  return new Promise<SessionRender>((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" })
    } catch {
      resolve(renderSession(session, takePcm, sampleRate, cuePcm))
      return
    }

    const fallback = () => {
      worker.terminate()
      resolve(renderSession(session, takePcm, sampleRate, cuePcm))
    }

    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      worker.terminate()
      if (e.data.ok) resolve(e.data.rendered)
      else resolve(renderSession(session, takePcm, sampleRate, cuePcm))
    }
    worker.onerror = fallback
    worker.onmessageerror = fallback

    const request: RenderRequest = { session, takePcm, sampleRate, cuePcm }
    worker.postMessage(request)
  })
}
