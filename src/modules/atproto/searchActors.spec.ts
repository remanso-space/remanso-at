import { afterEach, describe, expect, it, vi } from "vitest"

import { searchActors } from "./searchActors"

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

afterEach(() => {
  vi.restoreAllMocks()
})

describe("searchActors", () => {
  it("maps the appview's actors to suggestions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        actors: [
          { did: "did:plc:aaa", handle: "ana.example.com", displayName: "Ana", avatar: "a.jpg" },
          { did: "did:plc:bbb", handle: "bo.example.com" },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(searchActors("an")).resolves.toEqual([
      { did: "did:plc:aaa", handle: "ana.example.com", displayName: "Ana", avatar: "a.jpg" },
      { did: "did:plc:bbb", handle: "bo.example.com", displayName: undefined, avatar: undefined },
    ])

    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe("/xrpc/app.bsky.actor.searchActorsTypeahead")
    expect(url.searchParams.get("q")).toBe("an")
    expect(url.searchParams.get("limit")).toBe("8")
  })

  it("does not call the network for a blank query", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(searchActors("   ")).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("returns nothing rather than throwing when the lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    await expect(searchActors("ana")).resolves.toEqual([])

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response))
    await expect(searchActors("ana")).resolves.toEqual([])
  })

  it("treats a missing actors array as no matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okJson({})))
    await expect(searchActors("zzz")).resolves.toEqual([])
  })
})
