import { describe, expect, it } from "vitest"

import { audioMimeType, cueExtension } from "./cueImport"

const file = (name: string, type: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type })

describe("audioMimeType", () => {
  it("keeps a browser-supplied audio MIME", () => {
    expect(audioMimeType(file("song.mp3", "audio/mpeg"))).toBe("audio/mpeg")
  })

  it("falls back to the extension when the MIME is empty (Android SAF)", () => {
    expect(audioMimeType(file("song.mp3", ""))).toBe("audio/mpeg")
    expect(audioMimeType(file("clip.flac", "application/octet-stream"))).toBe("audio/flac")
  })

  it("rejects a non-audio file", () => {
    expect(audioMimeType(file("notes.pdf", "application/pdf"))).toBeNull()
    expect(audioMimeType(file("mystery", ""))).toBeNull()
  })
})

describe("cueExtension", () => {
  it("takes the extension from the name", () => {
    expect(cueExtension(file("theme.wav", "audio/wav"))).toBe("wav")
  })

  it("derives one from the MIME when the name has none", () => {
    expect(cueExtension(file("theme", "audio/mpeg"))).toBe("mp3")
  })

  it("falls back to bin for an unknown file", () => {
    expect(cueExtension(file("theme", "application/pdf"))).toBe("bin")
  })
})
