import type { DB } from './connection'
import type { NameCount, SearchQuery, SearchResult, Song, SongKey } from '../../shared/types'
import { isThemeId, type ThemeId } from '../../shared/themes'

/** Everything stored about a song that comes from its folder (files + song.json). */
export interface SongRecord {
  id: string
  folder: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  language: string | null
  durationMs: number
  instrumental: string
  vocals: string | null
  lyrics: string | null
  /** lyrics.txt: plain lyrics waiting to be timed */
  lyricsDraft: string | null
  /** lyrics were timed automatically and nobody has checked them yet */
  lyricsReview: boolean
  cover: string | null
  video: string | null
  videoOffsetMs: number
  theme: ThemeId | null
  key: SongKey | null
  transpose: number
  lyricsOffsetMs: number
  vocalOffsetMs: number
  guideVocalLevel: number | null
  addedAt: string
  scanSignature: string
}

export interface SongRow {
  rowid: number
  id: string
  folder: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  language: string | null
  duration_ms: number
  instrumental: string
  vocals: string | null
  lyrics: string | null
  lyrics_draft: string | null
  lyrics_review: number
  cover: string | null
  video: string | null
  video_offset_ms: number
  theme: string | null
  key_tonic: number | null
  key_mode: string | null
  key_source: string | null
  key_confidence: number | null
  analysis_status: string
  transpose: number
  lyrics_offset_ms: number
  vocal_offset_ms: number
  guide_vocal_level: number | null
  favorite: number
  play_count: number
  last_played_at: string | null
  added_at: string
  missing: number
  scan_signature: string
}

export function rowToSong(r: SongRow): Song {
  return {
    id: r.id,
    folder: r.folder,
    title: r.title,
    artist: r.artist,
    album: r.album,
    genre: r.genre,
    year: r.year,
    language: r.language,
    durationMs: r.duration_ms,
    hasVocals: !!r.vocals,
    hasLyrics: !!r.lyrics,
    lyricsDraft: !r.lyrics && !!r.lyrics_draft,
    lyricsReview: !!r.lyrics && !!r.lyrics_review,
    hasCover: !!r.cover,
    hasVideo: !!r.video,
    videoOffsetMs: r.video_offset_ms ?? 0,
    theme: isThemeId(r.theme) ? r.theme : null,
    key:
      r.key_tonic === null || r.key_mode === null
        ? null
        : {
            tonic: r.key_tonic,
            mode: r.key_mode as SongKey['mode'],
            source: (r.key_source ?? 'detected') as SongKey['source'],
            confidence: r.key_confidence
          },
    analysisStatus: r.analysis_status as Song['analysisStatus'],
    transpose: r.transpose,
    lyricsOffsetMs: r.lyrics_offset_ms,
    vocalOffsetMs: r.vocal_offset_ms,
    guideVocalLevel: r.guide_vocal_level,
    favorite: !!r.favorite,
    playCount: r.play_count,
    lastPlayedAt: r.last_played_at,
    addedAt: r.added_at,
    missing: !!r.missing
  }
}

export class SongsRepo {
  constructor(private db: DB) {}

  getRow(id: string): SongRow | undefined {
    return this.db.prepare('SELECT rowid, * FROM songs WHERE id = ?').get(id) as SongRow | undefined
  }

  get(id: string): Song | null {
    const r = this.getRow(id)
    return r ? rowToSong(r) : null
  }

  getMany(ids: string[]): Map<string, Song> {
    const out = new Map<string, Song>()
    if (ids.length === 0) return out
    const unique = [...new Set(ids)]
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500)
      const rows = this.db
        .prepare(`SELECT rowid, * FROM songs WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as SongRow[]
      for (const r of rows) out.set(r.id, rowToSong(r))
    }
    return out
  }

  byFolder(folder: string): SongRow | undefined {
    return this.db.prepare('SELECT rowid, * FROM songs WHERE folder = ?').get(folder) as SongRow | undefined
  }

  allFolders(): { id: string; folder: string; scan_signature: string; missing: number }[] {
    return this.db.prepare('SELECT id, folder, scan_signature, missing FROM songs').all() as never
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) c FROM songs WHERE missing = 0').get() as { c: number }).c
  }

  findDuplicate(artist: string, title: string): string | null {
    const r = this.db
      .prepare('SELECT id FROM songs WHERE lower(trim(artist)) = lower(trim(?)) AND lower(trim(title)) = lower(trim(?)) LIMIT 1')
      .get(artist, title) as { id: string } | undefined
    return r?.id ?? null
  }

  /** Insert or update the folder-derived fields; user fields (favorite, plays) are kept. */
  upsert(rec: SongRecord, lyricsText: string): void {
    const existing = this.getRow(rec.id)
    const keyCols = rec.key
      ? { key_tonic: rec.key.tonic, key_mode: rec.key.mode, key_source: rec.key.source, key_confidence: rec.key.confidence }
      : { key_tonic: null, key_mode: null, key_source: null, key_confidence: null }
    const params = {
      id: rec.id,
      folder: rec.folder,
      title: rec.title,
      artist: rec.artist,
      album: rec.album,
      genre: rec.genre,
      year: rec.year,
      language: rec.language,
      duration_ms: Math.round(rec.durationMs),
      instrumental: rec.instrumental,
      vocals: rec.vocals,
      lyrics: rec.lyrics,
      lyrics_draft: rec.lyricsDraft,
      lyrics_review: rec.lyricsReview ? 1 : 0,
      cover: rec.cover,
      video: rec.video,
      video_offset_ms: Math.round(rec.videoOffsetMs),
      theme: rec.theme,
      ...keyCols,
      analysis_status: rec.key ? 'done' : 'pending',
      transpose: rec.transpose,
      lyrics_offset_ms: rec.lyricsOffsetMs,
      vocal_offset_ms: rec.vocalOffsetMs,
      guide_vocal_level: rec.guideVocalLevel,
      added_at: rec.addedAt,
      scan_signature: rec.scanSignature
    }
    const tx = this.db.transaction(() => {
      // a different row may own this folder (e.g. song.json was replaced); drop it
      const clash = this.byFolder(rec.folder)
      if (clash && clash.id !== rec.id) this.deleteRow(clash.id)
      if (existing) {
        // keep a failed/ running status only if key is still unknown
        if (!rec.key && existing.analysis_status !== 'done') params.analysis_status = existing.analysis_status
        this.db
          .prepare(
            `UPDATE songs SET folder=@folder, title=@title, artist=@artist, album=@album, genre=@genre, year=@year,
             language=@language, duration_ms=@duration_ms, instrumental=@instrumental, vocals=@vocals, lyrics=@lyrics,
             lyrics_draft=@lyrics_draft, lyrics_review=@lyrics_review, cover=@cover, video=@video, video_offset_ms=@video_offset_ms, theme=@theme, key_tonic=@key_tonic, key_mode=@key_mode, key_source=@key_source, key_confidence=@key_confidence,
             analysis_status=@analysis_status, transpose=@transpose, lyrics_offset_ms=@lyrics_offset_ms,
             vocal_offset_ms=@vocal_offset_ms, guide_vocal_level=@guide_vocal_level, added_at=@added_at,
             scan_signature=@scan_signature, missing=0 WHERE id=@id`
          )
          .run(params)
      } else {
        this.db
          .prepare(
            `INSERT INTO songs (id, folder, title, artist, album, genre, year, language, duration_ms, instrumental, vocals,
             lyrics, lyrics_draft, lyrics_review, cover, video, video_offset_ms, theme, key_tonic, key_mode, key_source, key_confidence, analysis_status, transpose, lyrics_offset_ms,
             vocal_offset_ms, guide_vocal_level, added_at, scan_signature)
             VALUES (@id, @folder, @title, @artist, @album, @genre, @year, @language, @duration_ms, @instrumental, @vocals,
             @lyrics, @lyrics_draft, @lyrics_review, @cover, @video, @video_offset_ms, @theme, @key_tonic, @key_mode, @key_source, @key_confidence, @analysis_status, @transpose,
             @lyrics_offset_ms, @vocal_offset_ms, @guide_vocal_level, @added_at, @scan_signature)`
          )
          .run(params)
      }
      const row = this.getRow(rec.id)!
      this.db.prepare('DELETE FROM songs_fts WHERE rowid = ?').run(row.rowid)
      this.db
        .prepare('INSERT INTO songs_fts (rowid, title, artist, album, genre, lyrics_text) VALUES (?, ?, ?, ?, ?, ?)')
        .run(row.rowid, rec.title, rec.artist, rec.album ?? '', rec.genre ?? '', lyricsText)
    })
    tx()
  }

  deleteRow(id: string): void {
    const row = this.getRow(id)
    if (!row) return
    this.db.prepare('DELETE FROM songs_fts WHERE rowid = ?').run(row.rowid)
    this.db.prepare('DELETE FROM songs WHERE id = ?').run(id)
  }

  setMissing(id: string, missing: boolean): void {
    this.db.prepare('UPDATE songs SET missing = ? WHERE id = ?').run(missing ? 1 : 0, id)
  }

  setSignature(id: string, sig: string): void {
    this.db.prepare('UPDATE songs SET scan_signature = ? WHERE id = ?').run(sig, id)
  }

  /** Update editable columns (already validated by the caller). */
  updateFields(id: string, f: Record<string, unknown>): void {
    const allowed = [
      'title', 'artist', 'album', 'genre', 'year', 'language', 'transpose', 'lyrics_offset_ms', 'vocal_offset_ms',
      'guide_vocal_level', 'video_offset_ms', 'theme', 'key_tonic', 'key_mode', 'key_source', 'key_confidence', 'analysis_status'
    ]
    const cols = Object.keys(f).filter((k) => allowed.includes(k))
    if (cols.length === 0) return
    const row = this.getRow(id)
    if (!row) return
    this.db.transaction(() => {
      this.db.prepare(`UPDATE songs SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...Object.fromEntries(cols.map((c) => [c, f[c]])), id })
      if (cols.some((c) => ['title', 'artist', 'album', 'genre'].includes(c))) {
        const r = this.getRow(id)!
        this.db.prepare('UPDATE songs_fts SET title = ?, artist = ?, album = ?, genre = ? WHERE rowid = ?').run(r.title, r.artist, r.album ?? '', r.genre ?? '', r.rowid)
      }
    })()
  }

  setFavorite(id: string, on: boolean): void {
    this.db.prepare('UPDATE songs SET favorite = ? WHERE id = ?').run(on ? 1 : 0, id)
  }

  recordPlay(id: string, at: string): void {
    this.db.prepare('UPDATE songs SET play_count = play_count + 1, last_played_at = ? WHERE id = ?').run(at, id)
  }

  setAnalysis(id: string, status: Song['analysisStatus']): void {
    this.db.prepare('UPDATE songs SET analysis_status = ? WHERE id = ?').run(status, id)
  }

  setLyricsReview(id: string, on: boolean): void {
    this.db.prepare('UPDATE songs SET lyrics_review = ? WHERE id = ?').run(on ? 1 : 0, id)
  }

  /** Songs with pasted lyrics and a vocal track to time them against. */
  pendingLyrics(): string[] {
    return (
      this.db
        .prepare('SELECT id FROM songs WHERE lyrics_draft IS NOT NULL AND lyrics IS NULL AND vocals IS NOT NULL AND missing = 0 ORDER BY added_at DESC')
        .all() as { id: string }[]
    ).map((r) => r.id)
  }

  pendingAnalysis(): string[] {
    return (
      this.db
        .prepare("SELECT id FROM songs WHERE analysis_status IN ('pending','running') AND missing = 0 ORDER BY added_at DESC")
        .all() as { id: string }[]
    ).map((r) => r.id)
  }

  artists(): NameCount[] {
    return this.db
      .prepare(
        `SELECT artist AS name, count(*) AS count,
           (SELECT s2.id FROM songs s2 WHERE s2.artist = s.artist AND s2.cover IS NOT NULL LIMIT 1) AS coverSongId
         FROM songs s WHERE missing = 0 GROUP BY artist COLLATE NOCASE ORDER BY artist COLLATE NOCASE`
      )
      .all() as NameCount[]
  }

  genres(): NameCount[] {
    return this.db
      .prepare(
        `SELECT coalesce(genre, 'Unsorted') AS name, count(*) AS count,
           (SELECT s2.id FROM songs s2 WHERE coalesce(s2.genre,'Unsorted') = coalesce(s.genre,'Unsorted') AND s2.cover IS NOT NULL LIMIT 1) AS coverSongId
         FROM songs s WHERE missing = 0 GROUP BY coalesce(genre, 'Unsorted') COLLATE NOCASE ORDER BY name COLLATE NOCASE`
      )
      .all() as NameCount[]
  }

  search(q: SearchQuery): SearchResult {
    const where: string[] = []
    const params: unknown[] = []
    const terms = ftsTerms(q.text ?? '')
    let from = 'songs s'
    let select = 's.rowid, s.*'
    if (terms.length > 0) {
      from = 'songs_fts f JOIN songs s ON s.rowid = f.rowid'
      select += ", snippet(songs_fts, 4, '', '', '…', 10) AS snip, bm25(songs_fts, 10.0, 8.0, 2.0, 4.0, 1.0) AS rank"
      where.push('songs_fts MATCH ?')
      params.push(terms.map((t) => `"${t}"*`).join(' '))
    }
    if (q.genre) {
      if (q.genre === 'Unsorted') where.push('s.genre IS NULL')
      else {
        where.push('s.genre = ? COLLATE NOCASE')
        params.push(q.genre)
      }
    }
    if (q.artist) {
      where.push('s.artist = ? COLLATE NOCASE')
      params.push(q.artist)
    }
    if (q.hasVocals) where.push('s.vocals IS NOT NULL')
    if (q.hasLyrics) where.push('s.lyrics IS NOT NULL')
    if (q.favorite) where.push('s.favorite = 1')
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const sort = q.sort ?? (terms.length ? 'relevance' : 'title')
    const order =
      sort === 'relevance' && terms.length
        ? 'rank, s.title COLLATE NOCASE'
        : sort === 'artist'
          ? 's.artist COLLATE NOCASE, s.title COLLATE NOCASE'
          : sort === 'added'
            ? 's.added_at DESC'
            : sort === 'plays'
              ? 's.play_count DESC, s.last_played_at DESC'
              : 's.title COLLATE NOCASE'
    const limit = Math.min(q.limit ?? 500, 5000)
    const offset = q.offset ?? 0
    const total = (this.db.prepare(`SELECT count(*) c FROM ${from} ${whereSql}`).get(...params) as { c: number }).c
    const rows = this.db
      .prepare(`SELECT ${select} FROM ${from} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as (SongRow & { snip?: string })[]
    const songs = rows.map((r) => {
      const s = rowToSong(r)
      if (terms.length && r.snip) {
        const meta = `${s.title} ${s.artist} ${s.album ?? ''} ${s.genre ?? ''}`
        const metaTokens = tokenize(meta)
        const metaHit = terms.every((t) => metaTokens.some((m) => m.startsWith(t)))
        s.snippet = metaHit ? null : r.snip.replace(/\s+/g, ' ').trim()
      }
      return s
    })
    return { songs, total }
  }
}

/** Lower-case, accent-folded word tokens. */
export function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function ftsTerms(text: string): string[] {
  return tokenize(text).slice(0, 8)
}
