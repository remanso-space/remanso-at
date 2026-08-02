import { afterEach, describe, expect, it, vi } from "vitest"

import { blobUrl, docHandle, pdsEndpoint, resolveActor } from "./resolveActor"

const PDS = "https://pds.example.com"
const DID = "did:plc:abc"

const doc = (pds: string | null, aka = "at://you.example.com") => ({
  id: DID,
  alsoKnownAs: [aka],
  service: pds
    ? [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: pds }]
    : [],
})

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("pdsEndpoint", () => {
  it("finds the service by bare id and trims a trailing slash", () => {
    expect(pdsEndpoint(doc(`${PDS}/`))).toBe(PDS)
  })

  it("finds the service by fully qualified id", () => {
    expect(
      pdsEndpoint({
        id: DID,
        service: [
          { id: `${DID}#atproto_pds`, type: "AtprotoPersonalDataServer", serviceEndpoint: PDS },
        ],
      }),
    ).toBe(PDS)
  })

  it("returns null when the doc names no PDS", () => {
    expect(pdsEndpoint(doc(null))).toBeNull()
    expect(pdsEndpoint(null)).toBeNull()
  })
})

describe("docHandle", () => {
  it("strips the at:// prefix", () => {
    expect(docHandle(doc(PDS))).toBe("you.example.com")
  })

  it("returns null with no alsoKnownAs handle", () => {
    expect(docHandle({ id: DID })).toBeNull()
  })
})

describe("resolveActor", () => {
  it("reads a did:plc document from the PLC directory", async () => {
    const fetchMock = vi.fn(async () => okJson(doc(PDS)))
    vi.stubGlobal("fetch", fetchMock)

    expect(await resolveActor(DID)).toEqual({ did: DID, pds: PDS, handle: "you.example.com" })
    expect(fetchMock).toHaveBeenCalledWith(`https://plc.directory/${DID}`)
  })

  it("reads a did:web document from .well-known", async () => {
    const fetchMock = vi.fn(async () => okJson(doc(PDS)))
    vi.stubGlobal("fetch", fetchMock)

    await resolveActor("did:web:example.com")
    expect(fetchMock).toHaveBeenCalledWith("https://example.com/.well-known/did.json")
  })

  it("resolves a handle to a DID first, and tolerates a leading @", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("resolveHandle") ? okJson({ did: DID }) : okJson(doc(PDS)),
    )
    vi.stubGlobal("fetch", fetchMock)

    const resolved = await resolveActor("@you.example.com")
    expect(resolved).toEqual({ did: DID, pds: PDS, handle: "you.example.com" })
    expect(fetchMock.mock.calls[0][0]).toContain(
      "com.atproto.identity.resolveHandle?handle=you.example.com",
    )
  })

  it("returns null when the handle does not resolve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response),
    )
    expect(await resolveActor("nobody.example.com")).toBeNull()
  })

  it("returns null when the document names no PDS", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson(doc(null))),
    )
    expect(await resolveActor(DID)).toBeNull()
  })

  it("returns null for an empty actor without touching the network", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    expect(await resolveActor("   ")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("blobUrl", () => {
  it("builds a public getBlob URL", () => {
    // The DID's colons come back percent-encoded — URLSearchParams' doing, and what a
    // PDS decodes back to the same DID.
    expect(blobUrl({ pds: PDS, did: DID, cid: "bafyaudio" })).toBe(
      `${PDS}/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafyaudio`,
    )
  })
})
