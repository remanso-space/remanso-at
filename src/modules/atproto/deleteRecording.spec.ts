import { beforeEach, describe, expect, it, vi } from "vitest"

import { deleteRecording } from "./deleteRecording"
import { getActiveSession } from "./service/atprotoOAuth"

vi.mock("./service/atprotoOAuth", () => ({
  getActiveSession: vi.fn(),
}))

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

describe("deleteRecording", () => {
  beforeEach(() => {
    vi.mocked(getActiveSession).mockReset()
  })

  it("deletes the record at the given rkey in the caller's own repo", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce(okJson({}))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await deleteRecording({ did: "did:plc:abc", rkey: "3xyz" })).toEqual({ ok: true })

    const [path, init] = fetchHandler.mock.calls[0]
    expect(path).toBe("/xrpc/com.atproto.repo.deleteRecord")
    expect(init.method).toBe("POST")
    const body = JSON.parse(init.body)
    expect(body.repo).toBe("did:plc:abc")
    expect(body.collection).toBe("space.remanso.recording")
    expect(body.rkey).toBe("3xyz")
  })

  it("reports no-session when the OAuth session cannot be restored", async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null)

    expect(await deleteRecording({ did: "did:plc:abc", rkey: "3xyz" })).toEqual({
      ok: false,
      reason: "no-session",
    })
  })

  it("carries the XRPC error body into the failure detail", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "InvalidRequest", message: "bad rkey" }),
    } as unknown as Response)
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await deleteRecording({ did: "did:plc:abc", rkey: "3xyz" })).toEqual({
      ok: false,
      reason: "delete-failed",
      detail: "400 InvalidRequest: bad rkey",
    })
  })

  it("reports an exception when the request throws", async () => {
    const fetchHandler = vi.fn().mockRejectedValue(new Error("Failed to fetch"))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await deleteRecording({ did: "did:plc:abc", rkey: "3xyz" })).toEqual({
      ok: false,
      reason: "exception",
      detail: "Failed to fetch",
    })
  })
})
