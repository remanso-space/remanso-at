import { describe, expect, it, vi } from "vitest"

import fixture from "./openverse.fixture.json"
import { fetchToOpfs, PRESET_QUERIES, searchMusic, type MusicResult } from "./openverse"

// The fixture is a real Openverse answer (see its `note`), extended with the rows the mapper
// has to reject. `fetch` is passed in, so nothing here touches the network.

vi.mock("./opfsCues", () => ({
  writeCueFile: vi.fn(
    async (cueId: string, _file: File, extension: string) => `cues/${cueId}.${extension}`,
  ),
}))

const ok = (body: unknown): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

const status = (code: number): typeof fetch =>
  vi.fn(async () => new Response("", { status: code })) as unknown as typeof fetch

const results = async (fetchImpl: typeof fetch): Promise<MusicResult[]> => {
  const outcome = await searchMusic("calm ambient pad", 1, fetchImpl)
  expect(outcome.ok).toBe(true)
  return outcome.ok ? outcome.results : []
}

describe("searchMusic", () => {
  it("asks only for licences and providers the studio can actually use", async () => {
    const spy = vi.fn(
      async (_input: string) => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    )
    await searchMusic("drone", 2, spy as unknown as typeof fetch)

    const url = new URL(spy.mock.calls[0][0])
    expect(url.searchParams.get("q")).toBe("drone")
    expect(url.searchParams.get("license")).toBe("cc0,by")
    expect(url.searchParams.get("source")).toBe("freesound,wikimedia_audio")
    expect(url.searchParams.get("page")).toBe("2")
    // Jamendo cannot be fetched cross-origin, so it must never be asked for.
    expect(url.searchParams.get("source")).not.toContain("jamendo")
  })

  it("maps a real answer, converting milliseconds to seconds", async () => {
    const [first] = await results(ok(fixture))

    expect(first.title).toBe("Soundscape - Last 31 - Cinematic Piano")
    expect(first.creator).toBe("Tri-Tachyon")
    expect(first.durationSec).toBeCloseTo(36.5, 6)
    expect(first.audioUrl).toContain("cdn.freesound.org")
    expect(first.credit).toEqual({
      title: "Soundscape - Last 31 - Cinematic Piano",
      creator: "Tri-Tachyon",
      license: "by",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      sourceUrl: "https://freesound.org/people/Tri-Tachyon/sounds/353156",
    })
  })

  it("drops what it cannot use: no URL, share-alike, an unreadable container, no length", async () => {
    const ids = (await results(ok(fixture))).map((r) => r.id)

    expect(ids).toEqual([
      "5ee47804-c765-4da4-bf20-3382254456bd",
      "20502270-b305-450f-927f-1bc502814064",
    ])
  })

  it("returns nothing for a blank query without calling out", async () => {
    const spy = vi.fn()
    const outcome = await searchMusic("   ", 1, spy as unknown as typeof fetch)

    expect(outcome).toEqual({ ok: true, results: [] })
    expect(spy).not.toHaveBeenCalled()
  })

  it("names the rate limit rather than failing vaguely", async () => {
    const outcome = await searchMusic("drone", 1, status(429))

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.rateLimited).toBe(true)
      expect(outcome.error).toContain("minute")
    }
  })

  it("reports an unreachable library and an unreadable answer separately", async () => {
    const throwing = vi.fn(async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    const unreachable = await searchMusic("drone", 1, throwing)
    expect(unreachable).toEqual({ ok: false, error: "Could not reach the music library." })

    const garbage = vi.fn(
      async () => new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch
    const unreadable = await searchMusic("drone", 1, garbage)
    expect(unreadable.ok).toBe(false)

    const serverError = await searchMusic("drone", 1, status(503))
    expect(serverError.ok).toBe(false)
    if (!serverError.ok) expect(serverError.error).toContain("503")
  })
})

describe("fetchToOpfs", () => {
  const result: MusicResult = {
    id: "abc",
    title: "Pad",
    creator: "someone",
    durationSec: 30,
    filetype: "mp3",
    audioUrl: "https://cdn.freesound.org/previews/1/1.mp3",
    credit: {
      title: "Pad",
      creator: "someone",
      license: "cc0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      sourceUrl: "https://freesound.org/1",
    },
  }

  it("stores the bytes and hands back what a slot needs", async () => {
    const bytes = vi.fn(
      async () => new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" })),
    ) as unknown as typeof fetch

    const pick = await fetchToOpfs(result, bytes)

    expect(pick).toEqual({
      opfsPath: "cues/abc.mp3",
      sourceDurationSec: 30,
      credit: result.credit,
    })
  })

  it("gives back nothing when the download fails", async () => {
    expect(await fetchToOpfs(result, status(404))).toBeNull()

    const throwing = vi.fn(async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    expect(await fetchToOpfs(result, throwing)).toBeNull()
  })
})

describe("PRESET_QUERIES", () => {
  it("offers entry points for an author who does not know what to type", () => {
    expect(PRESET_QUERIES.length).toBeGreaterThan(2)
    expect(PRESET_QUERIES.every((q) => q.trim().length > 0)).toBe(true)
  })
})
