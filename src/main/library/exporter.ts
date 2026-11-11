import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { SongsRepo } from '../db/songs'
import type { ExportResult } from '../../shared/types'
import type { Library } from './library'
import { writePackage, type PackageSongSpec } from './karaokayFile'

const exists = (p: string): Promise<boolean> =>
  fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false)

/** Gather each song's files and metadata for a package. Songs without an instrumental on disk are skipped. */
export async function collectExport(songs: SongsRepo, library: Library, ids: string[], includeVideo: boolean): Promise<{ specs: PackageSongSpec[]; skipped: ExportResult['skipped'] }> {
  const specs: PackageSongSpec[] = []
  const skipped: ExportResult['skipped'] = []
  for (const id of [...new Set(ids)]) {
    const row = songs.getRow(id)
    if (!row) continue
    const label = `${row.artist} - ${row.title}`
    const dir = library.dirOf(row.folder)
    const ext = (n: string): string => path.extname(n).toLowerCase()
    const files: PackageSongSpec['files'] = []
    const add = async (name: string | null, as: (n: string) => string): Promise<void> => {
      if (name && (await exists(path.join(dir, name)))) files.push({ name: as(name), src: path.join(dir, name) })
    }
    await add(row.instrumental, (n) => `instrumental${ext(n)}`)
    if (!files.length) {
      skipped.push({ name: label, reason: 'its instrumental file is missing' })
      continue
    }
    await add(row.vocals, (n) => `vocals${ext(n)}`)
    // the library may hold any *.srt; the package always calls it lyrics.srt
    await add(row.lyrics, () => 'lyrics.srt')
    if (!row.lyrics) await add(row.lyrics_draft, () => 'lyrics.txt')
    await add(row.cover, (n) => `cover${ext(n) === '.png' ? '.png' : '.jpg'}`)
    if (includeVideo) await add(row.video, (n) => `background${ext(n)}`)
    const json = await library.songJsonFor(id)
    if (!json) continue
    if (!includeVideo) delete json.videoOffsetMs
    specs.push({ dir: label, json, files })
  }
  return { specs, skipped }
}

export async function exportSongs(
  songs: SongsRepo,
  library: Library,
  ids: string[],
  dest: string,
  opts: { includeVideo: boolean; generator: string },
  progress: (done: number, total: number) => void
): Promise<ExportResult> {
  const { specs, skipped } = await collectExport(songs, library, ids, opts.includeVideo)
  if (specs.length === 0) throw new Error(skipped[0] ? `nothing to export (${skipped[0].reason})` : 'nothing to export')
  await writePackage(dest, specs, opts.generator, progress)
  return { file: dest, exported: specs.length, skipped }
}
