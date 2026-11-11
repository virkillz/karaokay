import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createWriteStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'
import yazl from 'yazl'
import { PackageReader, openPackage, parseManifest, writePackage } from '../../src/main/library/karaokayFile'
import type { SongJson } from '../../src/main/library/songJson'

let tmp: string
beforeAll(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'karaokay-pkg-'))
})
afterAll(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const song = (over: Partial<SongJson> = {}): SongJson => ({
  schema: 1,
  id: 'test-song-0001',
  title: 'Song',
  artist: 'Artist',
  album: null,
  genre: 'Pop',
  year: 2020,
  language: 'en',
  key: { tonic: 9, mode: 'minor', source: 'manual', confidence: null },
  bpm: null,
  transpose: -2,
  lyricsOffsetMs: 150,
  vocalOffsetMs: 0,
  guideVocalLevel: 0.4,
  addedAt: '2026-01-01T00:00:00.000Z',
  ...over
})

/** build a zip by hand, for archives our writer would never produce */
async function zipOf(file: string, entries: { name: string; data: string | Buffer; mode?: number }[]): Promise<string> {
  const z = new yazl.ZipFile()
  for (const e of entries) z.addBuffer(Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data), e.name, e.mode ? { mode: e.mode } : {})
  z.end()
  await pipeline(z.outputStream as Readable, createWriteStream(file))
  return file
}
const manifest = (songs: unknown[], extra: Record<string, unknown> = {}): string => JSON.stringify({ format: 'karaokay', formatVersion: 1, songs, ...extra })

describe('writePackage → PackageReader round trip', () => {
  it('keeps bytes, metadata and hashes; de-duplicates folder names', async () => {
    const src = path.join(tmp, 'src')
    await fs.mkdir(src)
    const inst = randomBytes(300_000)
    const voc = randomBytes(1000)
    await fs.writeFile(path.join(src, 'a.flac'), inst)
    await fs.writeFile(path.join(src, 'b.mp3'), voc)
    await fs.writeFile(path.join(src, 'l.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHéllo\n')
    const dest = path.join(tmp, 'out.karaokay')
    const seen: number[] = []
    await writePackage(
      dest,
      [
        { dir: 'Artist - Song', json: song(), files: [{ name: 'instrumental.flac', src: path.join(src, 'a.flac') }, { name: 'vocals.mp3', src: path.join(src, 'b.mp3') }, { name: 'lyrics.srt', src: path.join(src, 'l.srt') }] },
        { dir: 'Artist - Song', json: song({ id: 'test-song-0002' }), files: [{ name: 'instrumental.flac', src: path.join(src, 'a.flac') }] }
      ],
      'test',
      (done) => seen.push(done)
    )
    expect(seen.at(-1)).toBe(inst.length * 2 + voc.length + (await fs.stat(path.join(src, 'l.srt'))).size)

    const { reader, info } = await openPackage(dest)
    try {
      expect(info.warnings).toEqual([])
      expect(info.songs.map((s) => s.path)).toEqual(['songs/Artist - Song', 'songs/Artist - Song (2)'])
      const first = info.songs[0]
      expect(first.json.title).toBe('Song')
      expect(first.json.transpose).toBe(-2)
      expect(first.json.key?.tonic).toBe(9)
      expect(first.files).toEqual({ instrumental: 'instrumental.flac', vocals: 'vocals.mp3', lyrics: 'lyrics.srt' })
      expect(info.manifest.songs[0].files?.['instrumental.flac']?.sha256).toMatch(/^[0-9a-f]{64}$/)

      const out = path.join(tmp, 'x1')
      await fs.mkdir(out)
      const names = await reader.extractSong(first, info.manifest, out)
      expect(names.sort()).toEqual(['instrumental.flac', 'lyrics.srt', 'vocals.mp3'])
      expect((await fs.readFile(path.join(out, 'instrumental.flac'))).equals(inst)).toBe(true)
      expect(await fs.readFile(path.join(out, 'lyrics.srt'), 'utf8')).toContain('Héllo')
    } finally {
      reader.close()
    }
    // no temp file left behind
    expect((await fs.readdir(tmp)).filter((n) => n.endsWith('.part'))).toEqual([])
  })
})

describe('PackageReader safety', () => {
  const okSong = (dir = 'songs/S'): { name: string; data: string }[] => [
    { name: `${dir}/song.json`, data: JSON.stringify(song()) },
    { name: `${dir}/instrumental.mp3`, data: 'audio' }
  ]

  it('rejects path traversal', async () => {
    const file = await zipOf(path.join(tmp, 'evil.karaokay'), [{ name: 'manifest.json', data: manifest([{ path: 'songs/zz' }]) }, { name: 'songs/zz/instrumental.mp3', data: 'x' }])
    // yazl refuses "..", so patch the names in place (same length)
    const buf = await fs.readFile(file)
    await fs.writeFile(file, Buffer.from(buf.toString('latin1').replaceAll('songs/zz/', '../../zz/'), 'latin1'))
    await expect(PackageReader.open(file)).rejects.toThrow()
  })

  it('rejects a bad song path in the manifest', async () => {
    const file = await zipOf(path.join(tmp, 'badpath.karaokay'), [{ name: 'manifest.json', data: manifest([{ path: '../outside' }]) }])
    await expect(openPackage(file)).rejects.toThrow(/bad song path/)
  })

  it('needs a manifest and refuses newer format versions', async () => {
    const none = await zipOf(path.join(tmp, 'nomanifest.karaokay'), okSong())
    await expect(openPackage(none)).rejects.toThrow(/no manifest/)
    const newer = await zipOf(path.join(tmp, 'newer.karaokay'), [{ name: 'manifest.json', data: manifest([], { formatVersion: 2 }) }])
    await expect(openPackage(newer)).rejects.toThrow(/newer Karaokay/)
  })

  it('skips symlinks and unknown files, and leaves out songs without an instrumental', async () => {
    const file = await zipOf(path.join(tmp, 'mixed.karaokay'), [
      { name: 'manifest.json', data: manifest([{ path: 'songs/S' }, { path: 'songs/NoInst' }, { path: 'songs/Missing' }]) },
      ...okSong(),
      { name: 'songs/S/cover.jpg', data: '/etc/passwd', mode: 0o120777 },
      { name: 'songs/S/run.sh', data: 'echo hi' },
      { name: 'songs/NoInst/song.json', data: JSON.stringify(song()) }
    ])
    const { reader, info } = await openPackage(file)
    reader.close()
    expect(info.songs.map((s) => s.name)).toEqual(['S'])
    expect(info.songs[0].files.cover).toBeUndefined()
    expect(info.warnings.join('\n')).toMatch(/symbolic link/)
    expect(info.warnings.join('\n')).toMatch(/unknown file "run.sh"/)
    expect(info.warnings.join('\n')).toMatch(/NoInst: left out, no instrumental/)
    expect(info.warnings.join('\n')).toMatch(/Missing: left out, no song.json/)
  })

  it('detects damaged files through the manifest checksum', async () => {
    const file = await zipOf(path.join(tmp, 'damaged.karaokay'), [
      { name: 'manifest.json', data: manifest([{ path: 'songs/S', files: { 'instrumental.mp3': { size: 5, sha256: '0'.repeat(64) } } }]) },
      ...okSong()
    ])
    const { reader, info } = await openPackage(file)
    try {
      const out = path.join(tmp, 'x2')
      await fs.mkdir(out)
      await expect(reader.extractSong(info.songs[0], info.manifest, out)).rejects.toThrow(/checksum/)
    } finally {
      reader.close()
    }
  })

  it('prefers FLAC over MP3 and timed lyrics over a draft', async () => {
    const file = await zipOf(path.join(tmp, 'prefs.karaokay'), [
      { name: 'manifest.json', data: manifest([{ path: 'songs/S/' }]) },
      ...okSong(),
      { name: 'songs/S/instrumental.flac', data: 'flac' },
      { name: 'songs/S/lyrics.txt', data: 'la la' },
      { name: 'songs/S/lyrics.srt', data: '1\n00:00:01,000 --> 00:00:02,000\nla\n' }
    ])
    const { reader, info } = await openPackage(file)
    reader.close()
    expect(info.songs[0].files).toEqual({ instrumental: 'instrumental.flac', lyrics: 'lyrics.srt' })
  })
})

describe('parseManifest', () => {
  it('validates the basics', () => {
    expect(() => parseManifest(null)).toThrow()
    expect(() => parseManifest({ format: 'other', formatVersion: 1, songs: [] })).toThrow(/not a Karaokay/)
    expect(() => parseManifest({ format: 'karaokay', formatVersion: 1, songs: [{ path: 'songs/a' }, { path: 'songs/A' }] })).toThrow(/twice/)
    expect(() => parseManifest({ format: 'karaokay', formatVersion: 1, songs: [{ path: 'songs/a/b' }] })).toThrow(/bad song path/)
    const m = parseManifest({ format: 'karaokay', formatVersion: 1, songs: [{ path: 'songs/a/', files: { 'Instrumental.MP3': { size: 3, sha256: 'nothex' } } }] })
    expect(m.songs[0]).toEqual({ path: 'songs/a', files: { 'instrumental.mp3': { size: 3 } } })
  })
})
