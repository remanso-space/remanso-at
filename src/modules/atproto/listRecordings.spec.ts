import { afterEach, describe, expect, it, vi } from "vitest"

import { listRecordings } from "./listRecordings"

const PDS = "https://pds.example.com"
const DID = "did:plc:abc"

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

const didDoc = okJson({
  id: DID,
  alsoKnownAs: ["at://you.example.com"],
  service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: PDS }],
})

const recording = (rkey: string, title?: string) => ({
  uri: `at://${DID}/space.remanso.recording/${rkey}`,
  value: {
    audio: { $type: "blob", ref: { $link: `bafy-${rkey}` }, mimeType: "audio/opus", size: 10 },
    ...(title ? { title } : {}),
    durationSec: 61,
    createdAt: "2026-07-01T10:00:00.000Z",
  },
})

const note = (rkey: string, title: string) => ({
  uri: `at://${DID}/space.remanso.note/${rkey}`,
  value: { title },
})

/** did doc, then the recording page, then the note page — the order listRecordings asks. */
const stubFetch = (recordings: unknown[], notes: unknown[] = [], cursor?: string) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("https://plc.directory")) return didDoc
    if (url.includes("space.remanso.recording")) return okJson({ records: recordings, cursor })
    if (url.includes("space.remanso.note")) return okJson({ records: notes })
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("listRecordings", () => {
  it("returns playable recordings with the note that shares their rkey", async () => {
    stubFetch([recording("3aaa", "Ep 1")], [note("3aaa", "Episode one")])

    const result = await listRecordings({ actor: DID })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.actor).toEqual({ did: DID, pds: PDS, handle: "you.example.com" })
    expect(result.recordings).toHaveLength(1)
    const [only] = result.recordings
    expect(only.rkey).toBe("3aaa")
    expect(only.audioUrl).toBe(
      `${PDS}/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafy-3aaa`,
    )
    expect(only.note).toEqual({
      title: "Episode one",
      url: "https://remanso.space/pub/abc/3aaa",
    })
  })

  it("leaves a standalone recording without a note link", async () => {
    stubFetch([recording("3bbb")], [note("3aaa", "Episode one")])

    const result = await listRecordings({ actor: DID })
    expect(result.ok && result.recordings[0].note).toBeNull()
  })

  it("does not ask the PDS to reverse the order — the default is newest first", async () => {
    const fetchMock = stubFetch([recording("3aaa")])
    await listRecordings({ actor: DID })

    const recordingCall = fetchMock.mock.calls
      .map(([url]) => url as string)
      .find((url) => url.includes("space.remanso.recording"))
    expect(recordingCall).not.toContain("reverse")
    expect(recordingCall).toContain("limit=100")
  })

  it("passes the cursor through and hands the next one back", async () => {
    const fetchMock = stubFetch([recording("3aaa")], [], "next-page")
    const result = await listRecordings({ actor: DID, cursor: "page-2" })

    expect(result.ok && result.cursor).toBe("next-page")
    expect(
      fetchMock.mock.calls.map(([url]) => url as string).find((u) => u.includes("recording")),
    ).toContain("cursor=page-2")
  })

  it("still returns the audio when the note titles cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://plc.directory")) return didDoc
        if (url.includes("space.remanso.recording")) {
          return okJson({ records: [recording("3aaa", "Ep 1")] })
        }
        return { ok: false, status: 500 } as unknown as Response
      }),
    )

    const result = await listRecordings({ actor: DID })
    expect(result.ok && result.recordings[0].note).toBeNull()
    expect(result.ok && result.recordings[0].value.title).toBe("Ep 1")
  })

  it("reports an unresolved actor rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
    )
    expect(await listRecordings({ actor: "nobody.example.com" })).toEqual({
      ok: false,
      reason: "unresolved-actor",
    })
  })

  it("surfaces a failed listRecords with its XRPC error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://plc.directory")) return didDoc
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "InvalidRequest", message: "bad collection" }),
        } as unknown as Response
      }),
    )

    const result = await listRecordings({ actor: DID })
    expect(result).toEqual({
      ok: false,
      reason: "list-failed",
      detail: "400 InvalidRequest: bad collection",
    })
  })
})
