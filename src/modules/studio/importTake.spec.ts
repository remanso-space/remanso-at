import { describe, expect, it } from "vitest"

import { IMPORT_ACCEPT, takeExtensionFor } from "./importTake"

// `importTake` writes to OPFS, which jsdom has no implementation of; it is verified in the
// app. What is testable is the part deciding whether a picked file is readable at all.

const fileOf = (name: string, type = ""): File => new File([new Uint8Array([1])], name, { type })

describe("takeExtensionFor", () => {
  it("takes a phone voice memo by its extension", () => {
    expect(takeExtensionFor(fileOf("Memo 3.m4a", "audio/mp4"))).toBe("m4a")
  })

  it("reads every container mediabunny is loaded with", () => {
    for (const ext of ["mp4", "mov", "mkv", "webm", "weba", "mp3", "wav", "ogg", "opus", "flac"]) {
      expect(takeExtensionFor(fileOf(`take.${ext}`))).toBe(ext)
    }
  })

  it("ignores the case of the extension", () => {
    expect(takeExtensionFor(fileOf("INTERVIEW.M4A"))).toBe("m4a")
  })

  it("falls back to the MIME type when the name lost its extension", () => {
    expect(takeExtensionFor(fileOf("recording", "audio/mpeg"))).toBe("mp3")
    expect(takeExtensionFor(fileOf("recording", "AUDIO/MP4"))).toBe("m4a")
  })

  it("refuses what no demuxer here can open", () => {
    expect(takeExtensionFor(fileOf("notes.pdf", "application/pdf"))).toBe(null)
    expect(takeExtensionFor(fileOf("track.aiff", "audio/aiff"))).toBe(null)
    expect(takeExtensionFor(fileOf("nameless"))).toBe(null)
  })

  it("offers m4a to the picker explicitly, since audio/* alone hides it on some", () => {
    expect(IMPORT_ACCEPT).toContain(".m4a")
    expect(IMPORT_ACCEPT).toContain("audio/*")
  })
})
