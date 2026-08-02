import { decodePeaks, encodePeaks, type Peaks } from "./peaks"

// Peaks live beside the takes in OPFS, in their own directory so a reconcile pass can
// tell a take (irreplaceable) from a derived artefact (recomputable in a second). They
// are written once when a take is analysed and read back when the review view mounts.
//
// Browser-coupled, like opfsTakes.ts; verified in the app, not jsdom.

const PEAKS_DIR = "peaks"

const peaksDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(PEAKS_DIR, { create: true })
}

const fileName = (path: string): string => path.replace(`${PEAKS_DIR}/`, "")

/** Write a take's peaks and hand back the path for `take.peaksPath`. */
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
