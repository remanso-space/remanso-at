// Cue files get their own OPFS directory so a reconcile pass can tell a cue (re-importable)
// from a take (irreplaceable). They share the takes' origin and quota, which matters against
// Safari's ~1 GB/origin.
//
// OPFS is unavailable in jsdom, so nothing here is unit-tested — it is verified in the app.

const CUES_DIR = "cues"

const cuesDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(CUES_DIR, { create: true })
}

const fileName = (path: string): string => path.replace(`${CUES_DIR}/`, "")

export const writeCueFile = async (
  cueId: string,
  file: File,
  extension: string,
): Promise<string> => {
  const dir = await cuesDir()
  const name = `${cueId}.${extension}`
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return `${CUES_DIR}/${name}`
}

export const readCueFile = async (path: string): Promise<File | null> => {
  try {
    const dir = await cuesDir()
    const handle = await dir.getFileHandle(fileName(path))
    return await handle.getFile()
  } catch {
    return null
  }
}

export const deleteCueFile = async (path: string): Promise<void> => {
  const dir = await cuesDir()
  await dir.removeEntry(fileName(path)).catch(() => {})
}

/** Reconciled against the saved EDL on open, to find orphaned files. */
export const listCuePaths = async (): Promise<string[]> => {
  const dir = await cuesDir()
  const paths: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") paths.push(`${CUES_DIR}/${name}`)
  }
  return paths
}
