import { decodePeaks, encodePeaks, type Peaks } from "./peaks"

// Peaks get their own OPFS directory so a reconcile pass can tell a take (irreplaceable)
// from a derived artefact (recomputable in a second).
//
// OPFS is unavailable in jsdom, so nothing here is unit-tested — it is verified in the app.

const PEAKS_DIR = "peaks"

const peaksDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(PEAKS_DIR, { create: true })
}

const fileName = (path: string): string => path.replace(`${PEAKS_DIR}/`, "")

export const writePeaks = async (takeId: string, peaks: Peaks): Promise<string> => {
  const dir = await peaksDir()
  const name = `${takeId}.peaks`
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(encodePeaks(peaks))
  await writable.close()
  return `${PEAKS_DIR}/${name}`
}

/** Null when the file is missing or written by another version — the caller recomputes. */
export const readPeaks = async (path: string): Promise<Peaks | null> => {
  if (!path) return null
  try {
    const dir = await peaksDir()
    const handle = await dir.getFileHandle(fileName(path))
    const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer())
    return decodePeaks(bytes)
  } catch {
    return null
  }
}

export const deletePeaks = async (path: string): Promise<void> => {
  if (!path) return
  const dir = await peaksDir()
  await dir.removeEntry(fileName(path)).catch(() => {})
}
