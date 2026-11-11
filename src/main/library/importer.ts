import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import jschardet from 'jschardet'
import iconv from 'iconv-lite'
import type { SongsRepo } from '../db/songs'
import type { ImportAnalysis, ImportCandidate, ImportResult } from '../../shared/types'
import { AUDIO_EXT, IMAGE_EXT, LYRICS_EXT, VIDEO_EXT, cleanTitle, groupFiles, sanitiseFolderName, splitArtistTitle } from './grouping'
import { readTags, type Library } from './library'
import { writeSongJson, type SongJson } from './songJson'
import { LYRICS_DRAFT } from './library'
import { isThemeId } from '../../shared/themes'
import { cuesToSrt, parseLrc } from '../../shared/srt'
import { PACKAGE_EXT, isPackageFile, openPackage, type PackageInfo, type PackageReader } from './karaokayFile'

/** media and lyric files the app owns in a song folder (cleared before a replace) */
const MEDIA_FILE_RE = /^(instrumental|vocals)\.(flac|wav|mp3)$|\.srt$|^lyrics\.txt$|^cover\.(jpe?g|png)$|^background\.(mp4|m4v|mov|webm)$/i
/** ids from packages are kept when they are plain, URL-safe tokens */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Tidy pasted or .txt lyrics: unify line endings, trim trailing spaces, at most one blank line in a row. */
export function tidyLyrics(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 50000)
}

const WANTED = [...AUDIO_EXT, ...LYRICS_EXT, ...IMAGE_EXT, ...VIDEO_EXT, PACKAGE_EXT]

/** Expand dropped files and folders into a flat list of candidate files. */
export async function expandPaths(paths: string[], limit = 5000): Promise<string[]> {
  const out: string[] = []
  const visit = async (p: string, depth: number): Promise<void> => {
    if (out.length >= limit || depth > 6) return
    const st = await fs.stat(p).catch(() => null)
    if (!st) return
    if (st.isDirectory()) {
      const names = await fs.readdir(p).catch(() => [] as string[])
      for (const n of names) if (!n.startsWith('.')) await visit(path.join(p, n), depth + 1)
    } else if (st.isFile() && WANTED.includes(path.extname(p).toLowerCase())) {
      out.push(p)
    }
  }
  for (const p of paths) await visit(p, 0)
  return out
}

/** Decode an SRT in whatever encoding it came in, return UTF-8 text. */
export function decodeText(buf: Buffer): string {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8')
  if (buf[0] === 0xff && buf[1] === 0xfe) return iconv.decode(buf.subarray(2), 'utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return iconv.decode(buf.subarray(2), 'utf16be')
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('�')) return utf8
  const guess = jschardet.detect(buf)
  const enc = guess?.encoding && iconv.encodingExists(guess.encoding) ? guess.encoding : 'windows-1252'
  return iconv.decode(buf, enc)
}

async function moveOrCopy(src: string, dest: string, move: boolean): Promise<void> {
  if (move) {
    try {
      await fs.rename(src, dest)
      return
    } catch {
      /* cross-device: fall back to copy */
    }
  }
  await fs.copyFile(src, dest)
  if (move) await fs.unlink(src).catch(() => undefined)
}

export class Importer {
  constructor(
    private songs: SongsRepo,
    private library: Library
  ) {}

  async analyse(paths: string[]): Promise<ImportAnalysis> {
    const all = await expandPaths(paths)
    const files = all.filter((f) => !isPackageFile(f))
    const { candidates: out, problems } = await this.analysePackages(all.filter(isPackageFile))
    const groups = groupFiles(files)
    for (const g of groups) {
      const tags = g.instrumental ? await readTags(g.instrumental) : null
      const fromName = splitArtistTitle(g.base)
      const title = tags?.title && tags.artist ? cleanTitle(tags.title) : fromName.title
      const artist = tags?.title && tags.artist ? tags.artist : (fromName.artist ?? tags?.artist ?? 'Unknown Artist')
      const duplicateOf = this.songs.findDuplicate(artist, title)
      out.push({
        key: `${g.dir}::${g.base}`,
        title,
        artist,
        album: tags?.album ?? null,
        genre: tags?.genre ?? null,
        year: tags?.year ?? null,
        instrumental: g.instrumental,
        vocals: g.vocals,
        lyrics: g.lyrics,
        lyricsText: null,
        cover: g.cover,
        video: g.video,
        pool: g.pool,
        duplicateOf,
        action: duplicateOf ? 'skip' : 'import'
      })
    }
    out.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
    return { candidates: out, problems }
  }

  private async analysePackages(files: string[]): Promise<ImportAnalysis> {
    const candidates: ImportCandidate[] = []
    const problems: string[] = []
    for (const file of files) {
      const label = path.basename(file)
      let info: PackageInfo
      try {
        const opened = await openPackage(file)
        opened.reader.close()
        info = opened.info
      } catch (e) {
        problems.push(`${label}: ${e instanceof Error ? e.message : e}`)
        continue
      }
      for (const w of info.warnings) problems.push(`${label}: ${w}`)
      for (const song of info.songs) {
        const fromName = splitArtistTitle(song.name)
        const title = song.json.title ?? fromName.title
        const artist = song.json.artist ?? fromName.artist ?? 'Unknown Artist'
        const sameId = song.json.id && this.songs.getRow(song.json.id) ? song.json.id : null
        const duplicateOf = sameId ?? this.songs.findDuplicate(artist, title)
        candidates.push({
          key: `${file}::${song.path}`,
          title,
          artist,
          album: song.json.album ?? null,
          genre: song.json.genre ?? null,
          year: song.json.year ?? null,
          instrumental: song.files.instrumental ?? null,
          vocals: song.files.vocals ?? null,
          lyrics: song.files.lyrics ?? song.files.draft ?? null,
          lyricsText: null,
          cover: song.files.cover ?? null,
          video: song.files.video ?? null,
          pool: [],
          duplicateOf,
          action: duplicateOf ? 'skip' : 'import',
          pkg: { file, path: song.path, bytes: song.bytes }
        })
      }
    }
    return { candidates, problems }
  }

  private async uniqueFolder(name: string): Promise<string> {
    const base = sanitiseFolderName(name)
    let candidate = base
    for (let i = 2; ; i++) {
      const exists = await fs.stat(this.library.dirOf(candidate)).then(() => true).catch(() => false)
      if (!exists) return candidate
      candidate = `${base} (${i})`
    }
  }

  async commit(items: ImportCandidate[], move: boolean, progress: (done: number, total: number) => void): Promise<ImportResult> {
    const todo = items.filter((i) => i.action !== 'skip' && i.instrumental)
    const result: ImportResult = { imported: [], failed: [] }
    await fs.mkdir(this.library.root, { recursive: true })
    let done = 0
    progress(0, todo.length)
    const packages = new Map<string, Promise<{ reader: PackageReader; info: PackageInfo }>>()
    try {
      for (const item of todo) {
        const label = `${item.artist} - ${item.title}`
        try {
          if (item.pkg) {
            const pkg = item.pkg
            if (!packages.has(pkg.file))
              packages.set(pkg.file, openPackage(pkg.file))
            const { reader, info } = await packages.get(pkg.file)!
            result.imported.push(await this.commitPackageSong(item, reader, info))
            continue
          }
          let folder: string
          let id: string = randomUUID()
          let prev: SongJson | null = null
          if (item.action === 'replace' && item.duplicateOf) {
            const row = this.songs.getRow(item.duplicateOf)
            if (!row) throw new Error('song to replace no longer exists')
            folder = row.folder
            id = row.id
            const dir = this.library.dirOf(folder)
            for (const n of await fs.readdir(dir)) {
              if (MEDIA_FILE_RE.test(n)) await fs.unlink(path.join(dir, n))
            }
            prev = {
              schema: 1, id, title: row.title, artist: row.artist, album: row.album, genre: row.genre, year: row.year,
              language: row.language, key: null, bpm: null, transpose: row.transpose, lyricsOffsetMs: 0,
              vocalOffsetMs: 0, guideVocalLevel: row.guide_vocal_level, addedAt: row.added_at,
              theme: isThemeId(row.theme) ? row.theme : null, videoOffsetMs: row.video_offset_ms
            }
          } else {
            folder = await this.uniqueFolder(label)
            await fs.mkdir(this.library.dirOf(folder), { recursive: true })
          }
          const dir = this.library.dirOf(folder)
          const ext = (p: string): string => path.extname(p).toLowerCase()

          await moveOrCopy(item.instrumental!, path.join(dir, `instrumental${ext(item.instrumental!)}`), move)
          if (item.vocals) await moveOrCopy(item.vocals, path.join(dir, `vocals${ext(item.vocals)}`), move)
          if (item.lyrics) {
            const text = decodeText(await fs.readFile(item.lyrics))
            const kind = ext(item.lyrics)
            const lrc = kind === '.lrc' ? parseLrc(text) : []
            if (kind === '.srt') await fs.writeFile(path.join(dir, 'lyrics.srt'), text, 'utf8')
            else if (lrc.length) await fs.writeFile(path.join(dir, 'lyrics.srt'), cuesToSrt(lrc), 'utf8')
            // .txt, or an .lrc without timestamps: plain lyrics to time later
            else await fs.writeFile(path.join(dir, LYRICS_DRAFT), tidyLyrics(text.replace(/\[[a-z]+:[^\]]*\]/gi, '')) + '\n', 'utf8')
            if (move) await fs.unlink(item.lyrics).catch(() => undefined)
          } else if (typeof item.lyricsText === 'string' && item.lyricsText.trim()) {
            await fs.writeFile(path.join(dir, LYRICS_DRAFT), tidyLyrics(item.lyricsText) + '\n', 'utf8')
          }
          if (item.video && VIDEO_EXT.includes(ext(item.video))) {
            // never move: a music video is often shared with other apps
            await fs.copyFile(item.video, path.join(dir, `background${ext(item.video)}`))
          }
          if (item.cover) {
            const e = ext(item.cover) === '.png' ? '.png' : '.jpg'
            await moveOrCopy(item.cover, path.join(dir, `cover${e}`), move && !items.some((o) => o !== item && o.cover === item.cover))
          } else {
            const tags = await readTags(path.join(dir, `instrumental${ext(item.instrumental!)}`), true)
            if (tags.picture) {
              const e = tags.picture.format.includes('png') ? '.png' : '.jpg'
              await fs.writeFile(path.join(dir, `cover${e}`), tags.picture.data)
            }
          }
          const json: SongJson = {
            schema: 1,
            id,
            title: item.title.trim() || 'Untitled',
            artist: item.artist.trim() || 'Unknown Artist',
            album: item.album,
            genre: item.genre,
            year: item.year,
            language: prev?.language ?? null,
            key: null,
            bpm: null,
            transpose: prev?.transpose ?? 0,
            lyricsOffsetMs: 0,
            vocalOffsetMs: 0,
            guideVocalLevel: prev?.guideVocalLevel ?? null,
            ...(prev?.theme ? { theme: prev.theme } : {}),
            ...(item.video && prev?.videoOffsetMs ? { videoOffsetMs: prev.videoOffsetMs } : {}),
            addedAt: prev?.addedAt ?? new Date().toISOString()
          }
          await writeSongJson(dir, json)
          if (item.action === 'replace') this.songs.setAnalysis(id, 'pending')
          const r = await this.library.scanFolder(folder, true)
          if (!r) throw new Error('could not read the imported folder')
          result.imported.push(r.id)
        } catch (e) {
          result.failed.push({ name: label, reason: e instanceof Error ? e.message : String(e) })
        } finally {
          progress(++done, todo.length)
        }
      }
    } finally {
      for (const p of packages.values()) void p.then((x) => x.reader.close()).catch(() => undefined)
    }
    return result
  }
  /** Import one song from an opened .karaokay package. Returns the song id. */
  private async commitPackageSong(item: ImportCandidate, reader: PackageReader, info: PackageInfo): Promise<string> {
    const song = info.songs.find((s) => s.path === item.pkg!.path)
    if (!song) throw new Error('song not found in the package')
    // extract next to the library (same disk, so the final rename is cheap); dot folders are never scanned
    const staging = path.join(this.library.root, `.import-${randomUUID()}`)
    await fs.mkdir(staging, { recursive: true })
    try {
      const names = await reader.extractSong(song, info.manifest, staging)
      // lyrics are stored as UTF-8 whatever the package used
      for (const n of names) {
        if (!/\.(srt|txt)$/i.test(n)) continue
        const text = decodeText(await fs.readFile(path.join(staging, n)))
        await fs.writeFile(path.join(staging, n), n.endsWith('.txt') ? tidyLyrics(text) + '\n' : text, 'utf8')
      }

      const pj = song.json
      const replacing = item.action === 'replace' && item.duplicateOf ? this.songs.getRow(item.duplicateOf) : null
      if (item.action === 'replace' && !replacing) throw new Error('song to replace no longer exists')
      let folder: string
      let id: string
      if (replacing) {
        folder = replacing.folder
        id = replacing.id
        const dir = this.library.dirOf(folder)
        for (const n of await fs.readdir(dir)) if (MEDIA_FILE_RE.test(n)) await fs.unlink(path.join(dir, n))
        for (const n of names) await fs.rename(path.join(staging, n), path.join(dir, n))
      } else {
        // keep the package's id so re-importing the same package is recognised as a duplicate
        id = pj.id && SAFE_ID.test(pj.id) && !this.songs.getRow(pj.id) ? pj.id : randomUUID()
        folder = await this.uniqueFolder(`${item.artist} - ${item.title}`)
        await fs.rename(staging, this.library.dirOf(folder))
      }
      const json: SongJson = {
        schema: 1,
        id,
        title: item.title.trim() || 'Untitled',
        artist: item.artist.trim() || 'Unknown Artist',
        album: item.album,
        genre: item.genre,
        year: item.year,
        language: pj.language ?? null,
        key: pj.key ?? null,
        bpm: pj.bpm ?? null,
        transpose: pj.transpose ?? 0,
        lyricsOffsetMs: pj.lyricsOffsetMs ?? 0,
        vocalOffsetMs: pj.vocalOffsetMs ?? 0,
        guideVocalLevel: pj.guideVocalLevel ?? null,
        ...(pj.lyricsReview && song.files.lyrics ? { lyricsReview: true } : {}),
        ...(pj.videoOffsetMs && song.files.video ? { videoOffsetMs: pj.videoOffsetMs } : {}),
        ...(pj.theme ? { theme: pj.theme } : {}),
        // "added" means added to this library
        addedAt: replacing?.added_at ?? new Date().toISOString()
      }
      await writeSongJson(this.library.dirOf(folder), json)
      if (replacing && !json.key) this.songs.setAnalysis(id, 'pending')
      const r = await this.library.scanFolder(folder, true)
      if (!r) throw new Error('could not read the imported folder')
      return r.id
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
