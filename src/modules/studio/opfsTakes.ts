// One OPFS file per take. FileSystemWritableFileStream appends a MediaRecorder chunk in
// constant time, so a 40-minute take streams to disk instead of growing a JS array in memory.
//
// OPFS is unavailable in jsdom, so nothing here is unit-tested — it is verified in the app.

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

/** `close` seals the file; `abort` discards a take that was cancelled mid-record. */
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

/** For imported files, which are already on disk. Recording uses `createTakeWriter` instead. */
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

/** Reconciled against the saved EDL on open, to find orphaned files. */
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
 * Safari caps an origin at ~1 GB and evicts under pressure, so warn when free space is under
 * a few times the expected take size. A refused persist request is the default, not a blocker.
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
