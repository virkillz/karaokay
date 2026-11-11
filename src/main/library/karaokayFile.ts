/**
 * .karaokay song packages: a ZIP archive holding one or more song folders plus a manifest.
 * The format is specified in docs/KARAOKAY_FORMAT.md; keep the two in step.
 */
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Transform, type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { parseSongJson, SONG_JSON, type SongJson } from './songJson'
import { sanitiseFolderName } from './grouping'

export const PACKAGE_EXT = '.karaokay'
export const PACKAGE_FORMAT = 'karaokay'
export const PACKAGE_VERSION = 1
export const MANIFEST = 'manifest.json'

const MiB = 1024 * 1024
const GiB = 1024 * MiB

export type PackageRole = 'meta' | 'instrumental' | 'vocals' | 'lyrics' | 'draft' | 'cover' | 'video'
export type MediaRole = Exclude<PackageRole, 'meta'>

/** Every file a song folder may hold, with its size limit. Anything else is ignored. */
const FILE_RULES: { role: PackageRole; re: RegExp; max: number; compress: boolean }[] = [
  { role: 'meta', re: /^song\.json$/i, max: MiB, compress: true },
  { role: 'instrumental', re: /^instrumental\.(flac|wav|mp3)$/i, max: 2 * GiB, compress: false },
  { role: 'vocals', re: /^vocals\.(flac|wav|mp3)$/i, max: 2 * GiB, compress: false },
  { role: 'lyrics', re: /^lyrics\.srt$/i, max: 5 * MiB, compress: true },
  { role: 'draft', re: /^lyrics\.txt$/i, max: 5 * MiB, compress: true },
  { role: 'cover', re: /^cover\.(jpe?g|png)$/i, max: 20 * MiB, compress: false },
  { role: 'video', re: /^background\.(mp4|m4v|mov|webm)$/i, max: 8 * GiB, compress: false }
]
export const LIMITS = { manifest: MiB, songs: 5000, entries: 50000 }
const AUDIO_PREFERENCE = ['.flac', '.wav', '.mp3']

export function ruleFor(name: string): (typeof FILE_RULES)[number] | null {
  return FILE_RULES.find((r) => r.re.test(name)) ?? null
}

export function isPackageFile(p: string): boolean {
  return path.extname(p).toLowerCase() === PACKAGE_EXT
}

// ---------------------------------------------------------------- manifest

export interface ManifestFile {
  size?: number
  sha256?: string
}
export interface ManifestSong {
  path: string
  files?: Record<string, ManifestFile>
}
export interface Manifest {
  format: typeof PACKAGE_FORMAT
  formatVersion: number
  generator?: string
  createdAt?: string
  songs: ManifestSong[]
}

/** songs/<name>, one safe path segment under songs/ */
const SONG_PATH = /^songs\/([^/\\\u0000-\u001f]{1,200})$/

export function parseManifest(value: unknown): Manifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('manifest.json is not a JSON object')
  const m = value as Record<string, unknown>
  if (m.format !== PACKAGE_FORMAT) throw new Error('not a Karaokay package (manifest "format" is not "karaokay")')
  const v = m.formatVersion
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error('manifest "formatVersion" is missing or invalid')
  if (v > PACKAGE_VERSION) throw new Error(`made by a newer Karaokay (format version ${v}); please update the app`)
  if (!Array.isArray(m.songs)) throw new Error('manifest "songs" must be an array')
  if (m.songs.length > LIMITS.songs) throw new Error(`too many songs (limit ${LIMITS.songs})`)
  const seen = new Set<string>()
  const songs: ManifestSong[] = []
  for (const s of m.songs as unknown[]) {
    if (!s || typeof s !== 'object') throw new Error('manifest song entries must be objects')
    const raw = s as Record<string, unknown>
    const p = typeof raw.path === 'string' ? raw.path.replace(/\/+$/, '') : ''
    const match = SONG_PATH.exec(p)
    if (!match || match[1] === '.' || match[1] === '..') throw new Error(`bad song path "${String(raw.path)}" (must be "songs/<folder>")`)
    if (seen.has(p.toLowerCase())) throw new Error(`song path listed twice: "${p}"`)
    seen.add(p.toLowerCase())
    let files: Record<string, ManifestFile> | undefined
    if (raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)) {
      files = {}
      for (const [name, f] of Object.entries(raw.files as Record<string, unknown>)) {
        if (!f || typeof f !== 'object') continue
        const fr = f as Record<string, unknown>
        files[name.toLowerCase()] = {
          ...(typeof fr.size === 'number' && Number.isSafeInteger(fr.size) && fr.size >= 0 ? { size: fr.size } : {}),
          ...(typeof fr.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(fr.sha256) ? { sha256: fr.sha256.toLowerCase() } : {})
        }
      }
    }
    songs.push({ path: p, ...(files ? { files } : {}) })
  }
  return {
    format: PACKAGE_FORMAT,
    formatVersion: v,
    ...(typeof m.generator === 'string' ? { generator: m.generator.slice(0, 200) } : {}),
    ...(typeof m.createdAt === 'string' ? { createdAt: m.createdAt.slice(0, 64) } : {}),
    songs
  }
}

// ---------------------------------------------------------------- reading

export interface PackageSong {
  /** "songs/<name>" */
  path: string
  /** the folder name inside songs/ */
  name: string
  json: Partial<SongJson>
  /** chosen file per role, as the lower-case name used in the library */
  files: Partial<Record<MediaRole, string>>
  /** total uncompressed bytes of the chosen files */
  bytes: number
}

export interface PackageInfo {
  manifest: Manifest
  songs: PackageSong[]
  /** songs or files that were left out, in plain words */
  warnings: string[]
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) =>
      err || !zip ? reject(err ?? new Error('could not open the package')) : resolve(zip)
    )
  )
}

function readAllEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const out: yauzl.Entry[] = []
    zip.on('entry', (e: yauzl.Entry) => {
      out.push(e)
      if (out.length > LIMITS.entries) {
        zip.close()
        reject(new Error('too many files in the package'))
        return
      }
      zip.readEntry()
    })
    zip.once('end', () => resolve(out))
    zip.once('error', reject)
    zip.readEntry()
  })
}

/** A safe, relative, forward-slash path with no "." or ".." segments. yauzl checks most of this already. */
function safeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || name.includes('\\') || /[\u0000-\u001f]/.test(name)) return false
  return name.split('/').every((seg, i, all) => (seg !== '' || i === all.length - 1) && seg !== '.' && seg !== '..')
}

export class PackageReader {
  private constructor(
    readonly file: string,
    private zip: yauzl.ZipFile,
    private entries: Map<string, yauzl.Entry>,
    private skipped: string[]
  ) {}

  static async open(file: string): Promise<PackageReader> {
    const zip = await openZip(file)
    try {
      const entries = new Map<string, yauzl.Entry>()
      const skipped: string[] = []
      for (const e of await readAllEntries(zip)) {
        if (e.fileName.endsWith('/')) continue // directory
        if (!safeEntryName(e.fileName)) throw new Error(`unsafe file name in package: "${e.fileName}"`)
        if (((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) {
          skipped.push(`${e.fileName} (a symbolic link)`)
          continue
        }
        if (e.isEncrypted()) {
          skipped.push(`${e.fileName} (encrypted)`)
          continue
        }
        const key = e.fileName.toLowerCase()
        if (entries.has(key)) throw new Error(`file appears twice in package: "${e.fileName}"`)
        entries.set(key, e)
      }
      return new PackageReader(file, zip, entries, skipped)
    } catch (e) {
      zip.close()
      throw e
    }
  }

  close(): void {
    this.zip.close()
  }

  private async stream(entry: yauzl.Entry): Promise<Readable> {
    return new Promise((resolve, reject) => this.zip.openReadStream(entry, (err, s) => (err || !s ? reject(err ?? new Error('read failed')) : resolve(s))))
  }

  private async readBuffer(entry: yauzl.Entry, max: number): Promise<Buffer> {
    if (entry.uncompressedSize > max) throw new Error(`${entry.fileName} is too large`)
    const chunks: Buffer[] = []
    for await (const c of await this.stream(entry)) chunks.push(c as Buffer)
    return Buffer.concat(chunks)
  }

  private async readJson(entry: yauzl.Entry, max: number): Promise<unknown> {
    const text = (await this.readBuffer(entry, max)).toString('utf8').replace(/^﻿/, '')
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${entry.fileName} is not valid JSON`)
    }
  }

  async info(): Promise<PackageInfo> {
    const m = this.entries.get(MANIFEST)
    if (!m) throw new Error('not a Karaokay package (no manifest.json)')
    const manifest = parseManifest(await this.readJson(m, LIMITS.manifest))
    const warnings = this.skipped.map((s) => `skipped ${s}`)
    const songs: PackageSong[] = []
    for (const ms of manifest.songs) {
      const name = ms.path.slice('songs/'.length)
      const prefix = `${ms.path.toLowerCase()}/`
      const names: string[] = []
      for (const [key, e] of this.entries) {
        if (!key.startsWith(prefix)) continue
        const rest = e.fileName.slice(prefix.length)
        if (rest.includes('/')) continue
        if (!ruleFor(rest)) {
          warnings.push(`${name}: ignored unknown file "${rest}"`)
          continue
        }
        names.push(rest.toLowerCase())
      }
      const metaEntry = this.entries.get(`${prefix}${SONG_JSON}`)
      if (!metaEntry) {
        warnings.push(`${name}: left out, no song.json`)
        continue
      }
      let json: Partial<SongJson> | null
      try {
        json = parseSongJson(await this.readJson(metaEntry, MiB))
      } catch (e) {
        warnings.push(`${name}: left out, ${e instanceof Error ? e.message : e}`)
        continue
      }
      if (!json) {
        warnings.push(`${name}: left out, song.json is not an object`)
        continue
      }
      const files: Partial<Record<MediaRole, string>> = {}
      let bytes = 0
      for (const role of ['instrumental', 'vocals', 'lyrics', 'draft', 'cover', 'video'] as const) {
        const rule = FILE_RULES.find((r) => r.role === role)!
        const options = names
          .filter((n) => rule.re.test(n))
          .sort((a, b) => AUDIO_PREFERENCE.indexOf(path.extname(a)) - AUDIO_PREFERENCE.indexOf(path.extname(b)))
        const pick = options.find((n) => this.entries.get(prefix + n)!.uncompressedSize <= rule.max)
        if (options.length && !pick) warnings.push(`${name}: ${options[0]} is too large, left out`)
        if (pick) {
          files[role] = pick
          bytes += this.entries.get(prefix + pick)!.uncompressedSize
        }
      }
      if (!files.instrumental) {
        warnings.push(`${name}: left out, no instrumental track`)
        continue
      }
      // timed lyrics win over a draft
      if (files.lyrics && files.draft) delete files.draft
      songs.push({ path: ms.path, name, json, files, bytes })
    }
    return { manifest, songs, warnings }
  }

  /**
   * Extract the chosen files of one song into `destDir` (which must exist and be empty).
   * Sizes and sha256 hashes listed in the manifest are verified. Returns the written names.
   */
  async extractSong(song: PackageSong, manifest: Manifest, destDir: string, onBytes?: (n: number) => void): Promise<string[]> {
    const expected = manifest.songs.find((s) => s.path === song.path)?.files ?? {}
    const written: string[] = []
    for (const name of Object.values(song.files)) {
      const entry = this.entries.get(`${song.path.toLowerCase()}/${name}`)
      if (!entry) throw new Error(`${name} is missing from the package`)
      const rule = ruleFor(name)!
      if (entry.uncompressedSize > rule.max) throw new Error(`${name} is too large`)
      const want = expected[name]
      if (want?.size !== undefined && want.size !== entry.uncompressedSize) throw new Error(`${name} has the wrong size`)
      const hash = createHash('sha256')
      const tap = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          hash.update(chunk)
          onBytes?.(chunk.length)
          cb(null, chunk)
        }
      })
      await pipeline(await this.stream(entry), tap, createWriteStream(path.join(destDir, name), { flags: 'wx' }))
      if (want?.sha256 && hash.digest('hex') !== want.sha256) throw new Error(`${name} is damaged (checksum mismatch)`)
      written.push(name)
    }
    return written
  }
}

// ---------------------------------------------------------------- writing

export interface PackageSongSpec {
  /** folder name inside songs/; made safe and unique here */
  dir: string
  json: SongJson
  /** `name` is the file name in the package (e.g. "instrumental.flac"); `src` an absolute path */
  files: { name: string; src: string }[]
}

/**
 * Write a .karaokay package. The archive is built next to `dest` and renamed into place,
 * so a failed export never leaves a half-written file under the real name.
 */
export async function writePackage(dest: string, songs: PackageSongSpec[], generator: string, onProgress?: (done: number, total: number) => void): Promise<void> {
  const used = new Set<string>()
  const plan = await Promise.all(
    songs.map(async (s) => {
      const files = await Promise.all(
        s.files.map(async (f) => {
          const name = f.name.toLowerCase()
          if (!ruleFor(name) || ruleFor(name)!.role === 'meta') throw new Error(`not a package file name: ${f.name}`)
          const st = await fs.stat(f.src)
          return { name, src: f.src, size: st.size, mtime: st.mtime }
        })
      )
      return { ...s, files }
    })
  )
  for (const s of plan) {
    const base = sanitiseFolderName(s.dir)
    let dir = base
    for (let i = 2; used.has(dir.toLowerCase()); i++) dir = `${base} (${i})`
    used.add(dir.toLowerCase())
    s.dir = dir
  }
  const total = plan.reduce((n, s) => n + s.files.reduce((m, f) => m + f.size, 0), 0)
  let done = 0
  onProgress?.(0, total)

  const tmp = `${dest}.${process.pid}.part`
  const zip = new yazl.ZipFile()
  const out = createWriteStream(tmp)
  const written = pipeline(zip.outputStream as Readable, out)
  const failed = new Promise<never>((_, reject) => zip.once('error', reject))
  failed.catch(() => undefined)
  try {
    const manifestSongs: ManifestSong[] = []
    const hashes: Promise<void>[] = []
    for (const s of plan) {
      const root = `songs/${s.dir}`
      const files: Record<string, ManifestFile> = {}
      const meta = Buffer.from(JSON.stringify(s.json, null, 2) + '\n', 'utf8')
      zip.addBuffer(meta, `${root}/${SONG_JSON}`, { compress: true })
      files[SONG_JSON] = { size: meta.length, sha256: createHash('sha256').update(meta).digest('hex') }
      for (const f of s.files) {
        const entry: ManifestFile = { size: f.size }
        files[f.name] = entry
        hashes.push(
          new Promise<void>((resolve, reject) => {
            zip.addReadStreamLazy(`${root}/${f.name}`, { compress: ruleFor(f.name)!.compress, size: f.size, mtime: f.mtime }, (cb) => {
              const hash = createHash('sha256')
              const src = createReadStream(f.src)
              const tap = new Transform({
                transform(chunk: Buffer, _enc, next) {
                  hash.update(chunk)
                  done += chunk.length
                  onProgress?.(done, total)
                  next(null, chunk)
                },
                flush(next) {
                  entry.sha256 = hash.digest('hex')
                  resolve()
                  next()
                }
              })
              src.once('error', (e) => {
                tap.destroy(e)
                reject(e)
              })
              cb(null, src.pipe(tap))
            })
          })
        )
      }
      manifestSongs.push({ path: root, files })
    }
    // the manifest goes last so it can carry the hashes computed while streaming
    await Promise.race([Promise.all(hashes), failed])
    const manifest: Manifest = { format: PACKAGE_FORMAT, formatVersion: PACKAGE_VERSION, generator, createdAt: new Date().toISOString(), songs: manifestSongs }
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'), MANIFEST, { compress: true })
    zip.end()
    await Promise.race([written, failed])
    await fs.rename(tmp, dest)
  } catch (e) {
    out.destroy()
    await fs.unlink(tmp).catch(() => undefined)
    throw e
  }
}

/** Open a package and read its manifest and song list; the reader is closed again on failure. */
export async function openPackage(file: string): Promise<{ reader: PackageReader; info: PackageInfo }> {
  const reader = await PackageReader.open(file)
  try {
    return { reader, info: await reader.info() }
  } catch (e) {
    reader.close()
    throw e
  }
}
