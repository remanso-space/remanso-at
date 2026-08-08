import { toRaw } from "vue"

import { renderSession, type CuePcm, type SessionRender, type TakePcm } from "./assemble"
import type { Session } from "./edl.types"

// Runs `renderSession` in a Worker where module workers exist, and falls straight back to a
// synchronous call where they do not (jsdom under test). Same result either way.

export interface RenderRequest {
  session: Session
  takePcm: TakePcm
  sampleRate: number
  cuePcm: CuePcm
}

export type RenderResponse = { ok: true; rendered: SessionRender } | { ok: false; error: string }

const canUseModuleWorker = (): boolean => typeof Worker !== "undefined"

/**
 * The PCM maps are copied into the Worker, since the main thread keeps owning them for
 * playback; the finished samples are transferred back. Any Worker failure — spawn, message
 * or a thrown render — falls back to the synchronous path.
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

    // The session arrives from the studio as a Vue reactive object; structuredClone chokes
    // on its proxy ("Proxy object could not be cloned") and, thrown here inside the executor,
    // that rejects the whole publish. Unwrap to the raw target first, and still guard the
    // post: any clone failure falls back to the synchronous render rather than killing it.
    const request: RenderRequest = { session: toRaw(session), takePcm, sampleRate, cuePcm }
    try {
      worker.postMessage(request)
    } catch {
      fallback()
    }
  })
}
