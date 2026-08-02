// Imported cue files (music, sound effects) live in their own OPFS directory next to the
// takes — same origin, same quota, so a 40 MB music file plus an hour of takes is a real
// budget question on Safari's ~1 GB/origin. A separate directory keeps a reconcile pass
// able to tell a cue (re-importable by the user) from a take (irreplaceable).
//
// Browser-coupled; verified in the app, not jsdom (OPFS is unavailable there). Mirrors
// opfsTakes.ts.

const CUES_DIR = "cues"

const cuesDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(CUES_DIR, { create: true })
}

const fileName = (path: string): string => path.replace(`${CUES_DIR}/`, "")

/** Store an imported cue file whole and hand back its OPFS path. */
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

/** Read a stored cue back as a File, ready for mediabunny's BlobSource. */
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

/** Every cue file currently in OPFS — for the reconcile pass on open. */
export const listCuePaths = async (): Promise<string[]> => {
  const dir = await cuesDir()
  const paths: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") paths.push(`${CUES_DIR}/${name}`)
  }
  return paths
}
