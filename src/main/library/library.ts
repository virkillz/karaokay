import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseFile } from 'music-metadata'
import { watch, type FSWatcher } from 'chokidar'
import type { SongsRepo, SongRecord } from '../db/songs'
import type { LibraryChange } from '../../shared/types'

export type MediaRoleFile = 'instrumental' | 'vocals' | 'lyrics' | 'cover' | 'video'
import { readSongJson, writeSongJson, SONG_JSON, type SongJson } from './songJson'
import { cleanTitle, splitArtistTitle } from './grouping'
import { srtToText } from '../../shared/srt'
import { isThemeId } from '../../shared/themes'

export interface Tags {
  title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  year: number | null
  durationMs: number
  picture: { data: Uint8Array; format: string } | null
}

export async function readTags(file: string, withPicture = false): Promise<Tags> {
  try {
    const meta = await parseFile(file, { duration: true, skipCovers: !withPicture })
    const c = meta.common
    const pic = withPicture && c.picture && c.picture.length > 0 ? c.picture[0] : null
    return {
      title: c.title?.trim() || null,
      artist: (c.artist ?? c.albumartist)?.trim() || null,
      album: c.album?.trim() || null,
      genre: c.genre && c.genre.length ? c.genre[0].trim() : null,
      year: c.year ?? null,
      durationMs: Math.round((meta.format.duration ?? 0) * 1000),
      picture: pic ? { data: pic.data, format: pic.format } : null
    }
  } catch {
    return { title: null, artist: null, album: null, genre: null, year: null, durationMs: 0, picture: null }
  }
}

const ROLE_PATTERNS: Record<MediaRoleFile, RegExp> = {
  instrumental: /^instrumental\.(flac|wav|mp3)$/i,
  vocals: /^vocals\.(flac|wav|mp3)$/i,
  lyrics: /\.srt$/i,
  cover: /^cover\.(jpe?g|png)$/i,
  video: /^background\.(mp4|m4v|mov|webm)$/i
}
const PREFERENCE = ['.flac', '.wav', '.mp3']
export const LYRICS_DRAFT = 'lyrics.txt'
const pickDraft = (names: string[]): string | null => names.find((n) => n.toLowerCase() === LYRICS_DRAFT) ?? null

export function pickRoleFile(names: string[], role: MediaRoleFile): string | null {
  const matches = names.filter((n) => ROLE_PATTERNS[role].test(n))
  if (matches.length === 0) return null
  if (role === 'lyrics') return matches.find((n) => n.toLowerCase() === 'lyrics.srt') ?? matches[0]
  return matches.sort((a, b) => PREFERENCE.indexOf(path.extname(a).toLowerCase()) - PREFERENCE.indexOf(path.extname(b).toLowerCase()))[0]
}

export class Library {
  private watcher: FSWatcher | null = null
  private scanning: Promise<LibraryChange> | null = null
  private rescanRequested = false
  private debounce: NodeJS.Timeout | null = null

  constructor(
    private songs: SongsRepo,
    private getRoot: () => string,
    private emit: (change: LibraryChange) => void
  ) {}

  get root(): string {
    return this.getRoot()
  }

  dirOf(folder: string): string {
    return path.join(this.root, folder)
  }

  /** Absolute path of a song's file for a role, or null. Never trusts renderer paths. */
  filePath(id: string, role: MediaRoleFile): string | null {
    const row = this.songs.getRow(id)
    if (!row) return null
    const name = row[role]
    if (!name) return null
    const abs = path.join(this.dirOf(row.folder), name)
    // stay inside the library root
    if (!abs.startsWith(path.resolve(this.root) + path.sep)) return null
    return abs
  }

  private async listSongFolders(): Promise<string[]> {
    const out: string[] = []
    const root = this.root
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(root, { withFileTypes: true })
    } catch {
      return out
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const dir = path.join(root, e.name)
      const names = await fs.readdir(dir).catch(() => [] as string[])
      if (pickRoleFile(names, 'instrumental')) {
        out.push(e.name)
        continue
      }
      // one level of manual grouping (Genre/Artist - Title)
      for (const sub of names) {
        const subDir = path.join(dir, sub)
        const st = await fs.stat(subDir).catch(() => null)
        if (!st?.isDirectory() || sub.startsWith('.')) continue
        const subNames = await fs.readdir(subDir).catch(() => [] as string[])
        if (pickRoleFile(subNames, 'instrumental')) out.push(path.join(e.name, sub))
      }
    }
    return out
  }

  private async signature(dir: string, names: string[]): Promise<string> {
    const parts: string[] = []
    for (const n of names.sort()) {
      if (n.endsWith('.tmp')) continue
      const st = await fs.stat(path.join(dir, n)).catch(() => null)
      if (st?.isFile()) parts.push(`${n}:${st.size}:${Math.round(st.mtimeMs)}`)
    }
    return parts.join('|')
  }

  /** Read one song folder into the database. Returns the song id, or null if it is not a song. */
  async scanFolder(folder: string, force = false): Promise<{ id: string; changed: boolean } | null> {
    const dir = this.dirOf(folder)
    const names = await fs.readdir(dir).catch(() => null)
    if (!names) return null
    const instrumental = pickRoleFile(names, 'instrumental')
    if (!instrumental) return null
    const vocals = pickRoleFile(names, 'vocals')
    const lyrics = pickRoleFile(names, 'lyrics')
    const cover = pickRoleFile(names, 'cover')
    const draft = pickDraft(names)
    const video = pickRoleFile(names, 'video')
    const sig = await this.signature(dir, [instrumental, vocals, lyrics, draft, cover, video, names.includes(SONG_JSON) ? SONG_JSON : null].filter((n): n is string => !!n))

    const existing = this.songs.byFolder(folder)
    if (!force && existing && existing.scan_signature === sig && !existing.missing) return { id: existing.id, changed: false }

    let json = await readSongJson(dir)
    const tags = await readTags(path.join(dir, instrumental))
    if (!json?.id || !json.title || !json.artist) {
      const fromName = splitArtistTitle(path.basename(folder))
      const created: SongJson = {
        schema: 1,
        id: json?.id ?? existing?.id ?? randomUUID(),
        title: json?.title ?? (tags.title ? cleanTitle(tags.title) : fromName.title),
        artist: json?.artist ?? tags.artist ?? fromName.artist ?? 'Unknown Artist',
        album: json?.album ?? tags.album,
        genre: json?.genre ?? tags.genre,
        year: json?.year ?? tags.year,
        language: json?.language ?? null,
        key: json?.key ?? null,
        bpm: json?.bpm ?? null,
        transpose: json?.transpose ?? 0,
        lyricsOffsetMs: json?.lyricsOffsetMs ?? 0,
        vocalOffsetMs: json?.vocalOffsetMs ?? 0,
        guideVocalLevel: json?.guideVocalLevel ?? null,
        addedAt: json?.addedAt ?? new Date().toISOString()
      }
      await writeSongJson(dir, created)
      json = created
    }
    // the same id in two folders (a copied folder): give the newcomer a fresh id
    const owner = this.songs.getRow(json.id!)
    if (owner && owner.folder !== folder) {
      const ownerExists = await fs.stat(this.dirOf(owner.folder)).then(() => true).catch(() => false)
      if (ownerExists) {
        json.id = randomUUID()
        await writeSongJson(dir, json as SongJson)
      }
    }

    let lyricsText = ''
    if (lyrics) {
      const raw = await fs.readFile(path.join(dir, lyrics), 'utf8').catch(() => '')
      lyricsText = srtToText(raw)
    } else if (draft) {
      // pasted lyrics are searchable before they are timed
      lyricsText = await fs.readFile(path.join(dir, draft), 'utf8').catch(() => '')
    }
    const finalSig = await this.signature(dir, [instrumental, vocals, lyrics, draft, cover, video, SONG_JSON].filter((n): n is string => !!n))
    const rec: SongRecord = {
      id: json.id!,
      folder,
      title: json.title!,
      artist: json.artist!,
      album: json.album ?? null,
      genre: json.genre ?? null,
      year: json.year ?? null,
      language: json.language ?? null,
      durationMs: tags.durationMs,
      instrumental,
      vocals,
      lyrics,
      lyricsDraft: draft,
      lyricsReview: !!lyrics && json.lyricsReview === true,
      cover,
      video,
      videoOffsetMs: json.videoOffsetMs ?? 0,
      theme: json.theme ?? null,
      key: json.key ?? null,
      transpose: json.transpose ?? 0,
      lyricsOffsetMs: json.lyricsOffsetMs ?? 0,
      vocalOffsetMs: json.vocalOffsetMs ?? 0,
      guideVocalLevel: json.guideVocalLevel ?? null,
      addedAt: json.addedAt ?? new Date().toISOString(),
      scanSignature: finalSig
    }
    this.songs.upsert(rec, lyricsText)
    return { id: rec.id, changed: true }
  }

  /** Full rescan; concurrent calls coalesce. */
  scanAll(): Promise<LibraryChange> {
    if (this.scanning) {
      this.rescanRequested = true
      return this.scanning
    }
    this.scanning = this.doScan().finally(() => {
      this.scanning = null
      if (this.rescanRequested) {
        this.rescanRequested = false
        void this.scanAll()
      }
    })
    return this.scanning
  }

  private async doScan(): Promise<LibraryChange> {
    await fs.mkdir(this.root, { recursive: true }).catch(() => undefined)
    const known = new Map(this.songs.allFolders().map((r) => [r.folder, r]))
    const found = await this.listSongFolders()
    const change: LibraryChange = { added: [], updated: [], removed: [] }
    for (const folder of found) {
      const before = known.get(folder)
      known.delete(folder)
      try {
        const r = await this.scanFolder(folder)
        if (r?.changed) (before ? change.updated : change.added).push(r.id)
      } catch (e) {
        console.error('scan failed', folder, e)
      }
    }
    for (const gone of known.values()) {
      if (!gone.missing) {
        this.songs.setMissing(gone.id, true)
        change.removed.push(gone.id)
      }
    }
    if (change.added.length || change.updated.length || change.removed.length) this.emit(change)
    return change
  }

  startWatching(): void {
    this.stopWatching()
    this.watcher = watch(this.root, {
      ignoreInitial: true,
      depth: 2,
      ignored: (p: string) => p.endsWith('.tmp') || path.basename(p).startsWith('.'),
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 }
    })
    this.watcher.on('all', () => {
      if (this.debounce) clearTimeout(this.debounce)
      this.debounce = setTimeout(() => void this.scanAll(), 1200)
    })
  }

  stopWatching(): void {
    void this.watcher?.close()
    this.watcher = null
  }

  /** Persist editable fields back to song.json. */
  async writeJsonFor(id: string): Promise<void> {
    const row = this.songs.getRow(id)
    const data = await this.songJsonFor(id)
    if (!row || !data) return
    const dir = this.dirOf(row.folder)
    await writeSongJson(dir, data)
    // keep the stored signature in step so the watcher does not treat our write as an external change
    const names = await fs.readdir(dir)
    const sig = await this.signature(dir, [row.instrumental, row.vocals, row.lyrics, row.lyrics_draft, row.cover, row.video, SONG_JSON].filter((n): n is string => !!n && names.includes(n)))
    this.songs.setSignature(id, sig)
  }

  /** The song.json content for a song, built from the database (the source of truth for edits). */
  async songJsonFor(id: string): Promise<SongJson | null> {
    const row = this.songs.getRow(id)
    if (!row) return null
    const prev = (await readSongJson(this.dirOf(row.folder))) ?? {}
    return {
      schema: 1,
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      genre: row.genre,
      year: row.year,
      language: row.language,
      key:
        row.key_tonic === null || row.key_mode === null
          ? null
          : { tonic: row.key_tonic, mode: row.key_mode as 'major' | 'minor', source: (row.key_source ?? 'detected') as 'detected' | 'manual', confidence: row.key_confidence },
      bpm: prev.bpm ?? null,
      transpose: row.transpose,
      lyricsOffsetMs: row.lyrics_offset_ms,
      vocalOffsetMs: row.vocal_offset_ms,
      guideVocalLevel: row.guide_vocal_level,
      ...(row.lyrics_review ? { lyricsReview: true } : {}),
      ...(row.video_offset_ms ? { videoOffsetMs: row.video_offset_ms } : {}),
      ...(isThemeId(row.theme) ? { theme: row.theme } : {}),
      addedAt: row.added_at
    }
  }
}
