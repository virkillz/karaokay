import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SongKey } from '../../shared/types'
import { isThemeId, type ThemeId } from '../../shared/themes'

export interface SongJson {
  schema: 1
  id: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  language: string | null
  key: SongKey | null
  bpm: number | null
  transpose: number
  lyricsOffsetMs: number
  vocalOffsetMs: number
  guideVocalLevel: number | null
  /** lyrics were timed automatically and not yet checked */
  lyricsReview?: boolean
  /** ms into the background video where the song starts */
  videoOffsetMs?: number
  theme?: ThemeId | null
  addedAt: string
}

export const SONG_JSON = 'song.json'

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function parseKey(v: unknown): SongKey | null {
  if (!v || typeof v !== 'object') return null
  const k = v as Record<string, unknown>
  if (typeof k.tonic !== 'number' || (k.mode !== 'major' && k.mode !== 'minor')) return null
  return {
    tonic: ((Math.round(k.tonic) % 12) + 12) % 12,
    mode: k.mode,
    source: k.source === 'manual' ? 'manual' : 'detected',
    confidence: numOrNull(k.confidence)
  }
}

/** Read and validate song.json. Returns null when missing or unusable. */
export async function readSongJson(dir: string): Promise<Partial<SongJson> | null> {
  try {
    return parseSongJson(JSON.parse(await fs.readFile(path.join(dir, SONG_JSON), 'utf8')))
  } catch {
    return null
  }
}

/** Validate already-parsed song.json content (from disk or from a .karaokay package). */
export function parseSongJson(value: unknown): Partial<SongJson> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const guide = numOrNull(raw.guideVocalLevel)
  const year = numOrNull(raw.year)
  const clamp = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, Math.round(v)))
  return {
    id: str(raw.id) ?? undefined,
    title: str(raw.title) ?? undefined,
    artist: str(raw.artist) ?? undefined,
    album: str(raw.album),
    genre: str(raw.genre),
    year: year !== null && year > 0 && year < 3000 ? Math.round(year) : null,
    language: str(raw.language),
    key: parseKey(raw.key),
    bpm: numOrNull(raw.bpm),
    transpose: clamp(num(raw.transpose, 0), 6),
    lyricsOffsetMs: clamp(num(raw.lyricsOffsetMs, 0), 10000),
    vocalOffsetMs: clamp(num(raw.vocalOffsetMs, 0), 10000),
    guideVocalLevel: guide === null ? null : Math.max(0, Math.min(1, guide)),
    lyricsReview: raw.lyricsReview === true,
    videoOffsetMs: clamp(num(raw.videoOffsetMs, 0), 600000),
    theme: isThemeId(raw.theme) ? raw.theme : null,
    addedAt: str(raw.addedAt) ?? undefined
  }
}

/** Write atomically so a crash never leaves a half-written file. */
export async function writeSongJson(dir: string, data: SongJson): Promise<void> {
  const file = path.join(dir, SONG_JSON)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
}
