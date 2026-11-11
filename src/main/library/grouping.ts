import path from 'node:path'

export const AUDIO_EXT = ['.flac', '.wav', '.mp3']
/** .srt and .lrc are timed; .txt is plain lyrics that get timed after import */
export const LYRICS_EXT = ['.srt', '.lrc', '.txt']
const LYRICS_RANK: Record<string, number> = { '.srt': 0, '.lrc': 1, '.txt': 2 }
export const IMAGE_EXT = ['.jpg', '.jpeg', '.png']
export const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.webm']

export type Role = 'instrumental' | 'vocals'

const VOCAL_MARKERS = ['lead vocals', 'lead vocal', 'a cappella', 'acappella', 'acapella', 'vocals only', 'vocals', 'vocal', 'vox']
const INST_MARKERS = [
  'karaoke version',
  'backing track',
  'minus one',
  'off vocal',
  'no vocals',
  'no vocal',
  'music only',
  'instrumental',
  'karaoke',
  'backing',
  'minus1',
  'novocals',
  'inst'
]

function markerRole(phrase: string): Role | null {
  const p = phrase.trim()
  if (INST_MARKERS.includes(p)) return 'instrumental'
  if (VOCAL_MARKERS.includes(p)) return 'vocals'
  // bracketed phrases like "instrumental version", "official karaoke"
  const words = p.split(/\s+/)
  if (words.some((w) => ['instrumental', 'karaoke', 'inst', 'backing'].includes(w))) return 'instrumental'
  if (words.some((w) => ['vocals', 'vocal', 'vox', 'acapella', 'acappella'].includes(w))) return 'vocals'
  return null
}

export interface NameInfo {
  /** display base with role markers removed, original casing */
  clean: string
  /** normalised key used for matching files */
  norm: string
  role: Role | null
}

export function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Strip role markers from a file base name ("Song (Instrumental)", "song_vox", "Song - Karaoke"). */
export function analyseName(base: string): NameInfo {
  let role: Role | null = null
  let s = base
  // bracketed segments
  s = s.replace(/[([{]([^)\]}]*)[)\]}]/g, (whole, inner: string) => {
    const r = markerRole(normalise(inner))
    if (r) {
      role = role ?? r
      return ' '
    }
    return whole
  })
  // trailing tokens after a separator
  const exactRole = (phrase: string): Role | null =>
    INST_MARKERS.includes(phrase) ? 'instrumental' : VOCAL_MARKERS.includes(phrase) ? 'vocals' : null
  for (;;) {
    s = s.replace(/[\s_\-.]+$/, '')
    const two = /^(.*?)[\s_\-.]+([\p{L}\p{N}]+[\s_\-.]+[\p{L}\p{N}]+)$/u.exec(s)
    const r2 = two ? exactRole(normalise(two[2])) : null
    if (two && r2) {
      role = role ?? r2
      s = two[1]
      continue
    }
    const one = /^(.*?)[\s_\-.]+([\p{L}\p{N}]+)$/u.exec(s)
    const r1 = one ? exactRole(normalise(one[2])) : null
    if (one && r1) {
      role = role ?? r1
      s = one[1]
      continue
    }
    break
  }
  // a whole name that is just a marker ("instrumental.flac", "vocals.mp3")
  const whole = normalise(s)
  if (!role) {
    if (INST_MARKERS.includes(whole)) {
      role = 'instrumental'
      s = ''
    } else if (VOCAL_MARKERS.includes(whole)) {
      role = 'vocals'
      s = ''
    }
  }
  const clean = s.replace(/[\s_]+/g, ' ').replace(/[\s\-–]+$/, '').trim()
  return { clean, norm: normalise(clean), role }
}

export interface FileGroup {
  /** display base for title parsing */
  base: string
  dir: string
  instrumental: string | null
  vocals: string | null
  lyrics: string | null
  cover: string | null
  video: string | null
  pool: string[]
}

const FORMAT_RANK: Record<string, number> = { '.flac': 3, '.wav': 2, '.mp3': 1 }
function better(a: string | null, b: string): string {
  if (!a) return b
  return (FORMAT_RANK[path.extname(b).toLowerCase()] ?? 0) > (FORMAT_RANK[path.extname(a).toLowerCase()] ?? 0) ? b : a
}

function assignAudio(group: FileGroup, files: string[]): void {
  const unmarked: string[] = []
  for (const f of files) {
    const info = analyseName(path.basename(f, path.extname(f)))
    if (info.role === 'vocals') group.vocals = better(group.vocals, f)
    else if (info.role === 'instrumental') group.instrumental = better(group.instrumental, f)
    else unmarked.push(f)
  }
  for (const f of unmarked) {
    if (!group.instrumental) group.instrumental = f
    else if (!group.vocals) group.vocals = f
  }
}

function pickByName(files: string[], norm: string, prefer: string[]): string | null {
  if (files.length === 0) return null
  const exact = files.find((f) => analyseName(path.basename(f, path.extname(f))).norm === norm)
  if (exact) return exact
  const named = files.find((f) => prefer.includes(normalise(path.basename(f, path.extname(f)))))
  return named ?? (files.length === 1 ? files[0] : null)
}

/**
 * Group a flat list of dropped files into candidate songs.
 * - A folder with at most two audio files is one song (the "folder per song" case).
 * - Otherwise files are matched by their name with role markers removed.
 */
export function groupFiles(paths: string[]): FileGroup[] {
  const byDir = new Map<string, string[]>()
  for (const p of paths) {
    const ext = path.extname(p).toLowerCase()
    if (![...AUDIO_EXT, ...LYRICS_EXT, ...IMAGE_EXT, ...VIDEO_EXT].includes(ext)) continue
    const dir = path.dirname(p)
    if (!byDir.has(dir)) byDir.set(dir, [])
    byDir.get(dir)!.push(p)
  }
  const groups: FileGroup[] = []
  const ext = (f: string): string => path.extname(f).toLowerCase()

  for (const [dir, files] of byDir) {
    const audio = files.filter((f) => AUDIO_EXT.includes(ext(f)))
    const lyricFiles = files.filter((f) => LYRICS_EXT.includes(ext(f))).sort((a, b) => LYRICS_RANK[ext(a)] - LYRICS_RANK[ext(b)])
    // a .txt is only lyrics when its name says so; otherwise a stray readme.txt would become lyrics
    const timed = lyricFiles.filter((f) => ext(f) !== '.txt')
    const texts = lyricFiles.filter((f) => ext(f) === '.txt')
    const images = files.filter((f) => IMAGE_EXT.includes(ext(f)))
    const videos = files.filter((f) => VIDEO_EXT.includes(ext(f)))
    if (audio.length === 0) continue

    const audioNames = audio.map((f) => analyseName(path.basename(f, ext(f))))
    const distinct = new Set(audioNames.map((n) => n.norm).filter(Boolean))
    if (audio.length <= 2 && distinct.size <= 1) {
      const g: FileGroup = { base: '', dir, instrumental: null, vocals: null, lyrics: null, cover: null, video: null, pool: files }
      assignAudio(g, audio)
      const instInfo = analyseName(path.basename(g.instrumental ?? audio[0], ext(g.instrumental ?? audio[0])))
      g.base = instInfo.clean || path.basename(dir)
      g.lyrics =
        pickByName(timed, instInfo.norm, ['lyrics', 'lyric']) ??
        timed[0] ??
        texts.find((f) => [instInfo.norm, 'lyrics', 'lyric'].includes(analyseName(path.basename(f, ext(f))).norm)) ??
        null
      g.cover = pickByName(images, instInfo.norm, ['cover', 'folder', 'front', 'artwork']) ?? images[0] ?? null
      g.video = pickByName(videos, instInfo.norm, ['background', 'video', 'mv', 'music video']) ?? videos[0] ?? null
      groups.push(g)
      continue
    }

    const byNorm = new Map<string, FileGroup & { audio: string[] }>()
    audio.forEach((f, i) => {
      const n = audioNames[i]
      const k = n.norm || normalise(path.basename(f, ext(f)))
      if (!byNorm.has(k)) byNorm.set(k, { base: n.clean || path.basename(f, ext(f)), dir, instrumental: null, vocals: null, lyrics: null, cover: null, video: null, pool: [], audio: [] })
      byNorm.get(k)!.audio.push(f)
    })
    for (const [k, g] of byNorm) {
      assignAudio(g, g.audio)
      g.lyrics = lyricFiles.find((f) => analyseName(path.basename(f, ext(f))).norm === k) ?? null
      g.cover = images.find((f) => analyseName(path.basename(f, ext(f))).norm === k) ?? null
      g.video = videos.find((f) => analyseName(path.basename(f, ext(f))).norm === k) ?? null
      g.pool = files
      const { audio: _a, ...rest } = g
      groups.push(rest)
    }
  }
  return groups
}

/** "Artist - Title" → parts. */
export function splitArtistTitle(base: string): { artist: string | null; title: string } {
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base.trim())
  if (m) return { artist: m[1].trim(), title: m[2].trim() }
  return { artist: null, title: base.trim() }
}

/** Remove role markers that some taggers put in the title tag. */
export function cleanTitle(title: string): string {
  return analyseName(title).clean || title.trim()
}

export function sanitiseFolderName(name: string): string {
  return (
    name
      .replace(/[/\\:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, 120) || 'Untitled'
  )
}
