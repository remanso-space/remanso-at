import type { MusicCredit, MusicPick } from "./edl.types"
import { writeCueFile } from "./opfsCues"

// Anonymous Openverse callers get 20 requests/minute and 200/day per client IP.
//
// Jamendo is excluded from `SOURCES` rather than filtered out of the results: its storage host
// pins `access-control-allow-origin` to an unrelated origin, and mixing needs the samples, not
// a playable URL — so a Jamendo track cannot be rendered into an episode at all.
//
// Licences are limited to CC0 and CC-BY. A recording is a derivative work, so CC-BY-SA would
// push its terms onto the whole episode.

const API = "https://api.openverse.org/v1/audio/"

const SOURCES = "freesound,wikimedia_audio"
const LICENSES = "cc0,by"
const PAGE_SIZE = 20

/** Containers `decodeTakeToMono` can read back out of OPFS. */
const DECODABLE = new Set(["mp3", "wav", "flac", "ogg", "oga", "opus", "m4a", "mp4", "webm"])

export const PRESET_QUERIES = [
  "calm ambient pad",
  "warm drone",
  "soft piano",
  "field recording rain",
  "slow strings",
  "short sting",
] as const

export interface MusicResult {
  id: string
  title: string
  creator: string
  /** Seconds. Openverse reports milliseconds; converted here so nothing downstream guesses. */
  durationSec: number
  filetype: string
  audioUrl: string
  credit: MusicCredit
}

export type SearchResult =
  | { ok: true; results: MusicResult[] }
  | { ok: false; error: string; rateLimited?: true }

interface ApiRow {
  id?: string
  title?: string
  creator?: string
  url?: string
  filetype?: string
  duration?: number
  license?: string
  license_url?: string
  foreign_landing_url?: string
}

const toResult = (row: ApiRow): MusicResult | null => {
  const license = row.license === "cc0" || row.license === "by" ? row.license : null
  const filetype = (row.filetype ?? "").toLowerCase()
  if (!row.id || !row.url || !license || !DECODABLE.has(filetype)) return null

  const durationSec = row.duration ? row.duration / 1000 : 0
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null

  return {
    id: row.id,
    title: row.title?.trim() || "untitled",
    creator: row.creator?.trim() || "unknown",
    durationSec,
    filetype,
    audioUrl: row.url,
    credit: {
      title: row.title?.trim() || "untitled",
      creator: row.creator?.trim() || "unknown",
      license,
      licenseUrl:
        row.license_url ??
        (license === "cc0"
          ? "https://creativecommons.org/publicdomain/zero/1.0/"
          : "https://creativecommons.org/licenses/by/4.0/"),
      sourceUrl: row.foreign_landing_url ?? row.url,
    },
  }
}

/**
 * Rows the studio cannot use — no playable URL, an undecodable container, a licence outside
 * the pool — are dropped here rather than failing at the moment the author picks them.
 */
export const searchMusic = async (
  query: string,
  page = 1,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResult> => {
  const trimmed = query.trim()
  if (!trimmed) return { ok: true, results: [] }

  const url = new URL(API)
  url.searchParams.set("q", trimmed)
  url.searchParams.set("license", LICENSES)
  url.searchParams.set("source", SOURCES)
  url.searchParams.set("page_size", String(PAGE_SIZE))
  url.searchParams.set("page", String(page))

  let response: Response
  try {
    response = await fetchImpl(url.toString())
  } catch {
    return { ok: false, error: "Could not reach the music library." }
  }

  if (response.status === 429) {
    return { ok: false, error: "Too many searches — try again in a minute.", rateLimited: true }
  }
  if (!response.ok) return { ok: false, error: `The music library answered ${response.status}.` }

  try {
    const body = (await response.json()) as { results?: ApiRow[] }
    const results = (body.results ?? []).map(toResult).filter((r): r is MusicResult => r !== null)
    return { ok: true, results }
  } catch {
    return { ok: false, error: "The music library sent something unreadable." }
  }
}

/**
 * The bytes are copied once, at pick time, so the render never touches the network and
 * publishing stays an offline operation.
 */
export const fetchToOpfs = async (
  result: MusicResult,
  fetchImpl: typeof fetch = fetch,
): Promise<MusicPick | null> => {
  try {
    const response = await fetchImpl(result.audioUrl)
    if (!response.ok) return null
    const blob = await response.blob()
    const file = new File([blob], `${result.id}.${result.filetype}`, {
      type: blob.type || `audio/${result.filetype}`,
    })
    const opfsPath = await writeCueFile(result.id, file, result.filetype)
    return { opfsPath, sourceDurationSec: result.durationSec, credit: result.credit }
  } catch {
    return null
  }
}
