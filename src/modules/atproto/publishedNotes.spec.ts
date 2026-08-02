import { beforeEach, describe, expect, it, vi } from "vitest"

import { getActiveSession } from "./service/atprotoOAuth"
import {
  listPublishedNotes,
  noteRecordingUris,
  recordingAltFor,
  recordingMarkdownLink,
} from "./publishedNotes"

vi.mock("./service/atprotoOAuth", () => ({
  getActiveSession: vi.fn(),
}))

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

const noteRecord = (uri: string, title: string, content: string) => ({
  uri,
  cid: "bafy",
  value: { $type: "space.remanso.note", title, content },
})

describe("noteRecordingUris", () => {
  it("finds an embedded recording link in markdown", () => {
    const content = "Intro\n\n![Ep 1 - audio](at://did:plc:abc/space.remanso.recording/3xyz)\n"
    expect(noteRecordingUris(content)).toEqual(["at://did:plc:abc/space.remanso.recording/3xyz"])
  })

  it("returns nothing for a note with no audio", () => {
    expect(
      noteRecordingUris("Just words, and a note link at://did:plc:abc/space.remanso.note/1"),
    ).toEqual([])
  })

  it("dedupes and preserves first-seen order across multiple embeds", () => {
    const content = `
      ![a](at://did:plc:abc/space.remanso.recording/aaa)
      ![b](at://did:plc:abc/space.remanso.recording/bbb)
      again ![a again](at://did:plc:abc/space.remanso.recording/aaa)
    `
    expect(noteRecordingUris(content)).toEqual([
      "at://did:plc:abc/space.remanso.recording/aaa",
      "at://did:plc:abc/space.remanso.recording/bbb",
    ])
  })

  it("does not bleed past the closing paren of a markdown link", () => {
    expect(
      noteRecordingUris("![x](at://did:plc:abc/space.remanso.recording/3xyz) trailing"),
    ).toEqual(["at://did:plc:abc/space.remanso.recording/3xyz"])
  })
})

describe("recordingAltFor", () => {
  it("appends the audio suffix used by the paste convention", () => {
    expect(recordingAltFor("Ma 間")).toBe("Ma 間 - audio")
  })
})

describe("recordingMarkdownLink", () => {
  it("builds the copyable link the studio hands back", () => {
    expect(recordingMarkdownLink("at://did:plc:abc/space.remanso.recording/3xyz", "Ep 1")).toBe(
      "![Ep 1 - audio](at://did:plc:abc/space.remanso.recording/3xyz)",
    )
  })

  it("round-trips: the link it builds is detected as embedded audio", () => {
    const uri = "at://did:plc:abc/space.remanso.recording/3xyz"
    expect(noteRecordingUris(recordingMarkdownLink(uri, "Ep 1"))).toEqual([uri])
  })
})

describe("listPublishedNotes", () => {
  beforeEach(() => vi.mocked(getActiveSession).mockReset())

  it("returns notes annotated with the audio they already embed", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce(
      okJson({
        cursor: "next",
        records: [
          noteRecord("at://did/space.remanso.note/1", "Silent", "no audio here"),
          noteRecord(
            "at://did/space.remanso.note/2",
            "Voiced",
            "![Voiced - audio](at://did/space.remanso.recording/rec2)",
          ),
        ],
      }),
    )
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    const result = await listPublishedNotes({ did: "did:plc:abc" })

    expect(result).toEqual({
      ok: true,
      cursor: "next",
      notes: [
        expect.objectContaining({ hasAudio: false, recordingUris: [] }),
        expect.objectContaining({
          hasAudio: true,
          recordingUris: ["at://did/space.remanso.recording/rec2"],
        }),
      ],
    })

    const [path, init] = fetchHandler.mock.calls[0]
    expect(path).toContain("/xrpc/com.atproto.repo.listRecords")
    expect(path).toContain("collection=space.remanso.note")
    expect(path).toContain("repo=did%3Aplc%3Aabc")
    expect(init.method).toBe("GET")
  })

  it("passes the cursor through for pagination", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce(okJson({ records: [] }))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    await listPublishedNotes({ did: "did:plc:abc", cursor: "page2" })

    expect(fetchHandler.mock.calls[0][0]).toContain("cursor=page2")
  })

  it("reports no-session when the OAuth session cannot be restored", async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null)

    expect(await listPublishedNotes({ did: "did:plc:abc" })).toEqual({
      ok: false,
      reason: "no-session",
    })
  })

  it("carries the XRPC error body into the failure detail", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "InvalidRequest", message: "bad repo" }),
    } as unknown as Response)
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listPublishedNotes({ did: "did:plc:abc" })).toEqual({
      ok: false,
      reason: "list-failed",
      detail: "400 InvalidRequest: bad repo",
    })
  })

  it("reports an exception when the request throws", async () => {
    const fetchHandler = vi.fn().mockRejectedValue(new Error("Failed to fetch"))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listPublishedNotes({ did: "did:plc:abc" })).toEqual({
      ok: false,
      reason: "exception",
      detail: "Failed to fetch",
    })
  })
})
