import { beforeEach, describe, expect, it, vi } from "vitest"

import { uploadRecording } from "../atproto/uploadRecording"
import { addTake, newSession } from "./edl"
import type { MusicPick, Session, Take } from "./edl.types"
import { SESSION_SAMPLE_RATE } from "./edl.types"
import { encodeOpus } from "./mediaCodec"
import { addSlot, fillSlot, newSlot } from "./musicSlots"
import { publishSession } from "./publishSession"

vi.mock("./mediaCodec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mediaCodec")>()),
  encodeOpus: vi.fn(),
}))
vi.mock("../atproto/uploadRecording", () => ({ uploadRecording: vi.fn() }))

const TAKE_SEC = 0.05

const take: Take = {
  id: "t1",
  opfsPath: "takes/t1.webm",
  durationSec: TAKE_SEC,
  peaksPath: "peaks/t1.bin",
  flags: [],
  label: "t1",
}

const sessionWithTake = (): Session => addTake(newSession("s", "Ep 1"), take, "c1")

/** Something audible: a silent take renders, but a tone keeps the loudness pass honest. */
const tone = (): Float32Array => {
  const n = Math.round(TAKE_SEC * SESSION_SAMPLE_RATE)
  return Float32Array.from(
    { length: n },
    (_, i) => 0.4 * Math.sin((i * 2 * Math.PI * 220) / SESSION_SAMPLE_RATE),
  )
}

const publishTake = (noteRkey?: string) =>
  publishSession({
    did: "did:plc:abc",
    session: sessionWithTake(),
    title: "Ep 1",
    takePcm: { t1: tone() },
    noteRkey,
  })

describe("publishSession", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(encodeOpus).mockResolvedValue({
      file: new File([new Uint8Array([1])], "ep.weba", { type: "audio/webm" }),
      mimeType: "audio/webm",
      bitrate: 64000,
    } as never)
    vi.mocked(uploadRecording).mockResolvedValue({
      ok: true,
      uri: "at://did:plc:abc/space.remanso.recording/note1",
    })
  })

  // Attached: the note gains its audio without the note changing, so there is nothing to paste.
  it("writes the recording at the note's rkey and hands back no link", async () => {
    const result = await publishTake("note1")

    expect(vi.mocked(uploadRecording).mock.calls[0][0]).toMatchObject({
      did: "did:plc:abc",
      title: "Ep 1",
      rkey: "note1",
    })
    expect(result).toMatchObject({
      ok: true,
      link: null,
      uri: "at://did:plc:abc/space.remanso.recording/note1",
    })
  })

  it("falls back to the copyable markdown link when no note was picked", async () => {
    const result = await publishTake()

    expect(vi.mocked(uploadRecording).mock.calls[0][0].rkey).toBeUndefined()
    expect(result).toMatchObject({
      ok: true,
      link: "![Ep 1 - audio](at://did:plc:abc/space.remanso.recording/note1)",
    })
  })

  it("reports the upload failure with its reason and detail", async () => {
    vi.mocked(uploadRecording).mockResolvedValue({
      ok: false,
      reason: "record-failed",
      detail: "400 InvalidSwap",
    })

    expect(await publishTake("note1")).toEqual({
      ok: false,
      error: "Publish failed (record-failed: 400 InvalidSwap).",
    })
  })

  // CC-BY is the only licence that asks for anything, so it is the only one that appears.
  it("carries CC-BY credits into the record and under the link", async () => {
    const pick: MusicPick = {
      opfsPath: "cues/pad.mp3",
      sourceDurationSec: 30,
      credit: {
        title: "Pad",
        creator: "someone",
        license: "by",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourceUrl: "https://freesound.org/pad",
      },
    }
    const slot = newSlot("intro", "m1")
    let session = addSlot(sessionWithTake(), slot)
    session = fillSlot(session, slot.id, pick)

    const result = await publishSession({
      did: "did:plc:abc",
      session,
      title: "Ep 1",
      takePcm: { t1: tone() },
      musicPcm: { "cues/pad.mp3": tone() },
    })

    expect(vi.mocked(uploadRecording).mock.calls[0][0].credits).toEqual([pick.credit])
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.link).toContain("Music: [Pad](https://freesound.org/pad)")
  })

  it("leaves a CC0 track out of the credits", async () => {
    const slot = newSlot("intro", "m1")
    let session = addSlot(sessionWithTake(), slot)
    session = fillSlot(session, slot.id, {
      opfsPath: "cues/pad.mp3",
      sourceDurationSec: 30,
      credit: {
        title: "Pad",
        creator: "someone",
        license: "cc0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: "https://freesound.org/pad",
      },
    })

    const result = await publishSession({
      did: "did:plc:abc",
      session,
      title: "Ep 1",
      takePcm: { t1: tone() },
      musicPcm: { "cues/pad.mp3": tone() },
    })

    expect(vi.mocked(uploadRecording).mock.calls[0][0].credits).toEqual([])
    if (result.ok) expect(result.link).not.toContain("Music:")
  })

  it("refuses an empty timeline before touching the encoder", async () => {
    expect(
      await publishSession({ did: "did:plc:abc", session: newSession("s", "Ep 1"), title: "Ep 1" }),
    ).toMatchObject({ ok: false })
    expect(encodeOpus).not.toHaveBeenCalled()
  })
})
