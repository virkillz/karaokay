import type { ThemeId } from './themes'

export type { ThemeId }

export type Mode = 'major' | 'minor'

export interface SongKey {
  tonic: number // pitch class 0..11, C = 0
  mode: Mode
  source: 'detected' | 'manual'
  confidence: number | null
}

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Song {
  id: string
  folder: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  language: string | null
  durationMs: number
  hasVocals: boolean
  hasLyrics: boolean
  /** pasted lyrics (lyrics.txt) are waiting to be timed */
  lyricsDraft: boolean
  /** lyrics were timed automatically; worth a check in the editor */
  lyricsReview: boolean
  hasCover: boolean
  /** background video (muted, focus mode only) */
  hasVideo: boolean
  /** seconds into the video when the song starts, in ms (positive skips an intro) */
  videoOffsetMs: number
  /** focus theme for this song; null = the default from Settings */
  theme: ThemeId | null
  key: SongKey | null
  analysisStatus: AnalysisStatus
  transpose: number
  lyricsOffsetMs: number
  vocalOffsetMs: number
  guideVocalLevel: number | null
  favorite: boolean
  playCount: number
  lastPlayedAt: string | null
  addedAt: string
  missing: boolean
  /** set by search when the match came from lyric text only */
  snippet?: string | null
}

export type EditableSongFields = Pick<
  Song,
  'title' | 'artist' | 'album' | 'genre' | 'year' | 'language' | 'transpose' | 'lyricsOffsetMs' | 'vocalOffsetMs' | 'guideVocalLevel' | 'videoOffsetMs' | 'theme'
> & { key: SongKey | null }

export type SortKey = 'relevance' | 'title' | 'artist' | 'added' | 'plays'

export interface SearchQuery {
  text?: string
  genre?: string | null
  artist?: string | null
  hasVocals?: boolean
  hasLyrics?: boolean
  favorite?: boolean
  sort?: SortKey
  limit?: number
  offset?: number
}

export interface SearchResult {
  songs: Song[]
  total: number
}

export interface QueueItem {
  id: string
  songId: string
  transpose: number | null
  song: Song
}

export interface Playlist {
  id: string
  name: string
  count: number
  durationMs: number
  createdAt: string
  updatedAt: string
}

export interface PlaylistDetail extends Playlist {
  songs: Song[]
}

export interface HistoryEntry {
  id: number
  playedAt: string
  transpose: number | null
  song: Song
}

export interface NameCount {
  name: string
  count: number
  coverSongId: string | null
}

export type ImportAction = 'import' | 'replace' | 'keepBoth' | 'skip'

export interface ImportCandidate {
  key: string
  title: string
  artist: string
  album: string | null
  genre: string | null
  year: number | null
  instrumental: string | null
  vocals: string | null
  lyrics: string | null
  /** lyrics pasted in the import dialog; timed after import */
  lyricsText: string | null
  cover: string | null
  /** background video, copied as background.<ext> */
  video: string | null
  /** every file the user dropped that could belong to this song (for the change/choose pickers) */
  pool: string[]
  duplicateOf: string | null
  action: ImportAction
  /**
   * set when the song comes from a .karaokay package: `file` is the package, `path` the song's
   * folder inside it. The role fields above then hold file names inside the package, for display.
   */
  pkg?: { file: string; path: string; bytes: number } | null
}

export interface ImportAnalysis {
  candidates: ImportCandidate[]
  /** songs or files that could not be read (e.g. a damaged .karaokay package) */
  problems: string[]
}

export interface ExportResult {
  file: string
  exported: number
  /** songs left out, with the reason */
  skipped: { name: string; reason: string }[]
}

export interface ImportResult {
  imported: string[]
  failed: { name: string; reason: string }[]
}

export interface Settings {
  libraryRoot: string
  importMode: 'copy' | 'move'
  defaultGuideVocal: number
  interstitialSeconds: number
  focusOnPlay: boolean
  volume: number
  focusTheme: ThemeId
}

export interface LibraryChange {
  added: string[]
  updated: string[]
  removed: string[]
}

export interface AlignedLine {
  text: string
  start: number
  end: number
  /** 0..1 aligner confidence; low means check this line */
  score: number
  /** no alignable letters (e.g. digits only); placed between neighbours */
  interpolated: boolean
}

export interface AlignResult {
  lines: AlignedLine[]
  srt: string
}

export interface AlignModelStatus {
  ready: boolean
  downloadMB: number
}

export interface AlignProgress {
  stage: 'download' | 'analyse' | 'align'
  progress: number
}

export interface Cue {
  start: number
  end: number
  text: string
}
