import { randomUUID } from 'node:crypto'
import type { DB } from './connection'
import type { SongsRepo } from './songs'
import type { HistoryEntry, Playlist, PlaylistDetail, QueueItem, Settings } from '../../shared/types'

export class QueueRepo {
  constructor(
    private db: DB,
    private songs: SongsRepo
  ) {}

  private rows(): { id: string; song_id: string; transpose: number | null }[] {
    return this.db.prepare('SELECT id, song_id, transpose FROM queue_items ORDER BY position').all() as never
  }

  list(): QueueItem[] {
    const rows = this.rows()
    const songs = this.songs.getMany(rows.map((r) => r.song_id))
    const out: QueueItem[] = []
    for (const r of rows) {
      const song = songs.get(r.song_id)
      if (song) out.push({ id: r.id, songId: r.song_id, transpose: r.transpose, song })
    }
    return out
  }

  private rewrite(rows: { id: string; song_id: string; transpose: number | null }[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM queue_items').run()
      const ins = this.db.prepare('INSERT INTO queue_items (id, position, song_id, transpose) VALUES (?, ?, ?, ?)')
      rows.forEach((r, i) => ins.run(r.id, i, r.song_id, r.transpose))
    })()
  }

  add(songIds: string[], where: 'end' | 'next'): QueueItem[] {
    const rows = this.rows()
    const fresh = songIds.map((song_id) => ({ id: randomUUID(), song_id, transpose: null }))
    this.rewrite(where === 'next' ? [...fresh, ...rows] : [...rows, ...fresh])
    return this.list()
  }

  replace(songIds: string[]): QueueItem[] {
    this.rewrite(songIds.map((song_id) => ({ id: randomUUID(), song_id, transpose: null })))
    return this.list()
  }

  move(itemId: string, toIndex: number): QueueItem[] {
    const rows = this.rows()
    const from = rows.findIndex((r) => r.id === itemId)
    if (from >= 0) {
      const [it] = rows.splice(from, 1)
      rows.splice(Math.max(0, Math.min(rows.length, toIndex)), 0, it)
      this.rewrite(rows)
    }
    return this.list()
  }

  remove(itemId: string): QueueItem[] {
    this.db.prepare('DELETE FROM queue_items WHERE id = ?').run(itemId)
    return this.list()
  }

  clear(): QueueItem[] {
    this.db.prepare('DELETE FROM queue_items').run()
    return []
  }

  /** Take the first playable item off the queue. */
  shift(): { item: QueueItem | null; queue: QueueItem[] } {
    const items = this.list()
    let item: QueueItem | null = null
    for (const it of items) {
      this.db.prepare('DELETE FROM queue_items WHERE id = ?').run(it.id)
      if (!it.song.missing) {
        item = it
        break
      }
    }
    return { item, queue: this.list() }
  }

  setTranspose(itemId: string, transpose: number | null): QueueItem[] {
    this.db.prepare('UPDATE queue_items SET transpose = ? WHERE id = ?').run(transpose, itemId)
    return this.list()
  }
}

export class PlaylistRepo {
  constructor(
    private db: DB,
    private songs: SongsRepo
  ) {}

  list(): Playlist[] {
    return (
      this.db
        .prepare(
          `SELECT p.id, p.name, p.created_at, p.updated_at, count(i.song_id) AS count, coalesce(sum(s.duration_ms), 0) AS dur
           FROM playlists p LEFT JOIN playlist_items i ON i.playlist_id = p.id LEFT JOIN songs s ON s.id = i.song_id
           GROUP BY p.id ORDER BY p.name COLLATE NOCASE`
        )
        .all() as { id: string; name: string; created_at: string; updated_at: string; count: number; dur: number }[]
    ).map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, updatedAt: r.updated_at, count: r.count, durationMs: r.dur }))
  }

  private songIds(id: string): string[] {
    return (
      this.db.prepare('SELECT song_id FROM playlist_items WHERE playlist_id = ? ORDER BY position').all(id) as { song_id: string }[]
    ).map((r) => r.song_id)
  }

  get(id: string): PlaylistDetail | null {
    const meta = this.list().find((p) => p.id === id)
    if (!meta) return null
    const ids = this.songIds(id)
    const map = this.songs.getMany(ids)
    return { ...meta, songs: ids.map((s) => map.get(s)).filter((s): s is NonNullable<typeof s> => !!s) }
  }

  create(name: string, songIds: string[]): Playlist {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db.prepare('INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name.trim() || 'New playlist', now, now)
    this.writeItems(id, songIds)
    return this.list().find((p) => p.id === id)!
  }

  rename(id: string, name: string): void {
    this.db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), new Date().toISOString(), id)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM playlists WHERE id = ?').run(id)
  }

  private writeItems(id: string, songIds: string[]): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id)
      const ins = this.db.prepare('INSERT INTO playlist_items (playlist_id, position, song_id) VALUES (?, ?, ?)')
      songIds.forEach((s, i) => ins.run(id, i, s))
      this.db.prepare('UPDATE playlists SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
    })()
  }

  addSongs(id: string, songIds: string[]): void {
    this.writeItems(id, [...this.songIds(id), ...songIds])
  }

  removeAt(id: string, position: number): void {
    const ids = this.songIds(id)
    ids.splice(position, 1)
    this.writeItems(id, ids)
  }

  move(id: string, from: number, to: number): void {
    const ids = this.songIds(id)
    const [it] = ids.splice(from, 1)
    if (it === undefined) return
    ids.splice(to, 0, it)
    this.writeItems(id, ids)
  }
}

export class HistoryRepo {
  constructor(
    private db: DB,
    private songs: SongsRepo
  ) {}

  record(songId: string, transpose: number): void {
    const at = new Date().toISOString()
    this.db.prepare('INSERT INTO history (song_id, played_at, transpose) VALUES (?, ?, ?)').run(songId, at, transpose)
    this.songs.recordPlay(songId, at)
  }

  list(limit: number): HistoryEntry[] {
    const rows = this.db
      .prepare('SELECT id, song_id, played_at, transpose FROM history ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; song_id: string; played_at: string; transpose: number | null }[]
    const map = this.songs.getMany(rows.map((r) => r.song_id))
    return rows
      .filter((r) => map.has(r.song_id))
      .map((r) => ({ id: r.id, playedAt: r.played_at, transpose: r.transpose, song: map.get(r.song_id)! }))
  }
}

export class SettingsRepo {
  constructor(
    private db: DB,
    private defaults: Settings
  ) {}

  getAll(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
    const out: Settings = { ...this.defaults }
    for (const r of rows) {
      if (r.key in out) {
        try {
          ;(out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
        } catch {
          /* ignore bad value */
        }
      }
    }
    return out
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value))
    return this.getAll()
  }
}
