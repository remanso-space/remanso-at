import { beforeEach, describe, expect, it, vi } from "vitest"

import { getActiveSession } from "vue-atproto-login"
import {
  listPublishedNotes,
  listRecordingRkeys,
  noteRecordingUris,
  recordingAltFor,
  recordingMarkdownLink,
} from "./publishedNotes"

vi.mock("vue-atproto-login", () => ({
  getActiveSession: vi.fn(),
}))

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response

const noteRecord = (uri: string, title: string, content: string) => ({
  uri,
  cid: "bafy",
  value: { $type: "space.remanso.note", title, content },
})

/** The second call listPublishedNotes makes. */
const recordingList = (...rkeys: string[]) =>
  okJson({
    records: rkeys.map((rkey) => ({ uri: `at://did:plc:abc/space.remanso.recording/${rkey}` })),
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
    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          cursor: "next",
          records: [
            noteRecord("at://did:plc:abc/space.remanso.note/1", "Silent", "no audio here"),
            noteRecord(
              "at://did:plc:abc/space.remanso.note/2",
              "Voiced",
              "![Voiced - audio](at://did:plc:abc/space.remanso.recording/rec2)",
            ),
          ],
        }),
      )
      .mockResolvedValueOnce(recordingList())
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    const result = await listPublishedNotes({ did: "did:plc:abc" })

    expect(result).toEqual({
      ok: true,
      cursor: "next",
      notes: [
        expect.objectContaining({ attached: false, hasAudio: false, recordingUris: [] }),
        expect.objectContaining({
          attached: false,
          hasAudio: true,
          recordingUris: ["at://did:plc:abc/space.remanso.recording/rec2"],
        }),
      ],
    })

    const [path, init] = fetchHandler.mock.calls[0]
    expect(path).toContain("/xrpc/com.atproto.repo.listRecords")
    expect(path).toContain("collection=space.remanso.note")
    expect(path).toContain("repo=did%3Aplc%3Aabc")
    expect(init.method).toBe("GET")
  })

  // The attached model: a recording at the note's own rkey, nothing in the content.
  it("marks a note attached when a recording sits at its rkey", async () => {
    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          records: [
            noteRecord("at://did:plc:abc/space.remanso.note/1", "Voiced", "no link in the body"),
            noteRecord("at://did:plc:abc/space.remanso.note/2", "Silent", "nor here"),
          ],
        }),
      )
      .mockResolvedValueOnce(recordingList("1"))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    const result = await listPublishedNotes({ did: "did:plc:abc" })

    expect(result).toMatchObject({
      ok: true,
      notes: [
        { attached: true, hasAudio: true, recordingUris: [] },
        { attached: false, hasAudio: false },
      ],
    })

    const recordingsPath = fetchHandler.mock.calls[1][0]
    expect(recordingsPath).toContain("collection=space.remanso.recording")
  })

  // The audio markers are an annotation. Losing them must not cost the user the picker.
  it("degrades to unattached notes when the recordings list fails", async () => {
    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          records: [noteRecord("at://did:plc:abc/space.remanso.note/1", "Voiced", "words")],
        }),
      )
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listPublishedNotes({ did: "did:plc:abc" })).toMatchObject({
      ok: true,
      notes: [{ attached: false, hasAudio: false }],
    })
  })

  it("passes the cursor through for pagination", async () => {
    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(okJson({ records: [] }))
      .mockResolvedValueOnce(recordingList())
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

describe("listRecordingRkeys", () => {
  beforeEach(() => vi.mocked(getActiveSession).mockReset())

  it("collects the rkey of every recording in the repo", async () => {
    const fetchHandler = vi.fn().mockResolvedValueOnce(recordingList("3aaa", "3bbb"))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set(["3aaa", "3bbb"]))
  })

  it("follows the cursor so recordings past the first page still count as attached", async () => {
    const page = (cursor: string | undefined, ...rkeys: string[]) =>
      okJson({
        records: rkeys.map((rkey) => ({
          uri: `at://did:plc:abc/space.remanso.recording/${rkey}`,
        })),
        cursor,
      })

    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(page("3bbb", "3aaa", "3bbb"))
      .mockResolvedValueOnce(page(undefined, "3ccc"))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set(["3aaa", "3bbb", "3ccc"]))
    expect(fetchHandler.mock.calls[1][0]).toContain("cursor=3bbb")
  })

  it("stops on an empty page even when the PDS keeps handing back a cursor", async () => {
    const fetchHandler = vi.fn().mockResolvedValue(okJson({ records: [], cursor: "3zzz" }))
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set())
    expect(fetchHandler).toHaveBeenCalledTimes(1)
  })

  it("keeps the pages it already walked when a later one fails", async () => {
    const fetchHandler = vi
      .fn()
      .mockResolvedValueOnce(
        okJson({
          records: [{ uri: "at://did:plc:abc/space.remanso.recording/3aaa" }],
          cursor: "3aaa",
        }),
      )
      .mockResolvedValueOnce({ ok: false, status: 500 })
    vi.mocked(getActiveSession).mockResolvedValue({ fetchHandler } as never)

    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set(["3aaa"]))
  })

  it("is empty when there is no session, a failure, or a throw", async () => {
    vi.mocked(getActiveSession).mockResolvedValue(null)
    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set())

    vi.mocked(getActiveSession).mockResolvedValue({
      fetchHandler: vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    } as never)
    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set())

    vi.mocked(getActiveSession).mockResolvedValue({
      fetchHandler: vi.fn().mockRejectedValue(new Error("Failed to fetch")),
    } as never)
    expect(await listRecordingRkeys("did:plc:abc")).toEqual(new Set())
  })
})
