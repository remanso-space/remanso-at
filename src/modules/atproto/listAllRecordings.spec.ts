import { afterEach, describe, expect, it, vi } from "vitest"

import { listAllRecordings } from "./listAllRecordings"

const PDS_A = "https://pds-a.example.com"
const PDS_B = "https://pds-b.example.com"
const DID_A = "did:plc:aaa"
const DID_B = "did:plc:bbb"

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

const didDoc = (did: string, pds: string, handle: string) =>
  okJson({
    id: did,
    alsoKnownAs: [`at://${handle}`],
    service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pds }],
  })

const row = (did: string, rkey: string, extra: Record<string, unknown> = {}) => ({
  did,
  rkey,
  durationSec: 42,
  recordedAt: null,
  createdAt: "2026-08-01T10:00:00.000Z",
  blobCid: `bafy-${rkey}`,
  mimeType: "video/webm",
  size: 123,
  ...extra,
})

const stubFetch = (rows: unknown[], docs: Record<string, Response>, cursor?: string) => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("/recordings")) return okJson({ recordings: rows, cursor })
    for (const [did, doc] of Object.entries(docs)) if (url.includes(did)) return doc
    throw new Error(`unexpected fetch: ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe("listAllRecordings", () => {
  it("maps appview rows to playable recordings, carrying credits and resolving each PDS", async () => {
    const credits = [
      {
        title: "Pad",
        creator: "someone",
        license: "cc-by",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourceUrl: "https://freesound.org/x",
      },
    ]
    stubFetch(
      [row(DID_A, "3aaa", { title: "One", credits }), row(DID_B, "3bbb", { title: "Two" })],
      {
        [DID_A]: didDoc(DID_A, PDS_A, "a.example.com"),
        [DID_B]: didDoc(DID_B, PDS_B, "b.example.com"),
      },
      "cur1",
    )

    const result = await listAllRecordings()
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.cursor).toBe("cur1")
    expect(result.recordings).toHaveLength(2)
    const [a, b] = result.recordings
    expect(a.value.title).toBe("One")
    expect(a.value.credits).toEqual(credits)
    expect(a.note).toBeNull()
    expect(a.audioUrl).toBe(
      `${PDS_A}/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aaaa&cid=bafy-3aaa`,
    )
    expect(b.value.credits).toBeUndefined()
    expect(b.audioUrl).toBe(
      `${PDS_B}/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Abbb&cid=bafy-3bbb`,
    )
  })

  it("drops a row whose DID will not resolve rather than show an unplayable blob", async () => {
    const didC = "did:plc:ccc"
    const didD = "did:plc:ddd"
    stubFetch([row(didC, "3ccc"), row(didD, "3ddd")], {
      [didC]: didDoc(didC, PDS_A, "c.example.com"),
      // didD has no doc → its fetch throws → resolveActor returns null → row dropped.
    })

    const result = await listAllRecordings()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.recordings).toHaveLength(1)
    expect(result.recordings[0].uri).toContain(didC)
  })

  it("reports a failed appview response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }) as unknown as Response),
    )
    const result = await listAllRecordings()
    expect(result).toEqual({ ok: false, reason: "list-failed", detail: "HTTP 503" })
  })
})
