// OPFS is where take bytes live. FileSystemWritableFileStream appends a MediaRecorder
// chunk in constant time, so a 40-minute take streams to disk as it records instead of
// growing a JS array in memory — the single biggest robustness win for recording on a
// phone (plan: "Storage"). getFile() hands back a real File that goes straight into
// mediabunny's BlobSource with no copy. One OPFS file per take.
//
// All browser-coupled; verified in the app, not jsdom (OPFS is unavailable there).

const TAKES_DIR = "takes"

const takesDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(TAKES_DIR, { create: true })
}

const fileName = (path: string): string => path.replace(`${TAKES_DIR}/`, "")

export interface TakeWriter {
  path: string
  write: (chunk: BlobPart) => Promise<void>
  close: () => Promise<void>
  abort: () => Promise<void>
}

/**
 * Open a streaming writer for a take. Chunks are appended as MediaRecorder emits them;
 * `close` seals the file, `abort` discards a take that was cancelled mid-record.
 */
export const createTakeWriter = async (takeId: string, extension: string): Promise<TakeWriter> => {
  const dir = await takesDir()
  const name = `${takeId}.${extension}`
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  return {
    path: `${TAKES_DIR}/${name}`,
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: async () => {
      try {
        await writable.abort()
      } catch {
        // already closed
      }
      await dir.removeEntry(name).catch(() => {})
    },
  }
}

/**
 * Store an already-finished audio file as a take, whole. The recording path streams chunks
 * through `createTakeWriter`; an imported file is already on disk and only needs a copy into
 * OPFS, so the two never share a code path beyond the directory they land in.
 */
export const writeTakeFile = async (
  takeId: string,
  file: File,
  extension: string,
): Promise<string> => {
  const dir = await takesDir()
  const name = `${takeId}.${extension}`
  const handle = await dir.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
  return `${TAKES_DIR}/${name}`
}

/** Read a stored take back as a File, ready for mediabunny's BlobSource. */
export const readTakeFile = async (path: string): Promise<File | null> => {
  try {
    const dir = await takesDir()
    const handle = await dir.getFileHandle(fileName(path))
    return await handle.getFile()
  } catch {
    return null
  }
}

export const deleteTake = async (path: string): Promise<void> => {
  const dir = await takesDir()
  await dir.removeEntry(fileName(path)).catch(() => {})
}

/** Every take file currently in OPFS — used to reconcile against the saved EDL on open. */
export const listTakePaths = async (): Promise<string[]> => {
  const dir = await takesDir()
  const paths: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") paths.push(`${TAKES_DIR}/${name}`)
  }
  return paths
}

export interface QuotaCheck {
  freeBytes: number
  enough: boolean
  persisted: boolean
}

/**
 * Before a session, warn if free space is under a few times the expected take size —
 * Safari's ~1 GB/origin with eviction under pressure is the real constraint. Also asks the
 * browser to persist the origin; treat a refusal as the default rather than a blocker.
 */
export const checkQuota = async (expectedBytes: number): Promise<QuotaCheck> => {
  let persisted = false
  try {
    persisted =
      (await navigator.storage.persisted?.()) || (await navigator.storage.persist?.()) || false
  } catch {
    persisted = false
  }
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate()
    const freeBytes = Math.max(0, quota - usage)
    return { freeBytes, enough: freeBytes >= expectedBytes * 3, persisted }
  } catch {
    return { freeBytes: 0, enough: true, persisted }
  }
}
