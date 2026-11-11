import type {
  AlignModelStatus,
  AlignProgress,
  AlignResult,
  EditableSongFields,
  ExportResult,
  ImportAnalysis,
  HistoryEntry,
  ImportCandidate,
  ImportResult,
  LibraryChange,
  NameCount,
  Playlist,
  PlaylistDetail,
  QueueItem,
  SearchQuery,
  SearchResult,
  Settings,
  Song,
  SongKey
} from './types'

/** Request/response channels: name -> handler signature. */
export interface InvokeMap {
  'library:search': (q: SearchQuery) => SearchResult
  'library:get': (id: string) => Song | null
  'library:artists': () => NameCount[]
  'library:genres': () => NameCount[]
  'library:update': (id: string, patch: Partial<EditableSongFields>) => Song
  'library:setFavorite': (id: string, on: boolean) => void
  'library:remove': (id: string, deleteFiles: boolean) => void
  'library:readLyrics': (id: string) => string | null
  'library:rescan': () => void
  'library:reveal': (id: string) => void
  'library:count': () => number
  /** 'pick' asks for a video file and copies it in as background.<ext>; 'remove' deletes it */
  'library:setVideo': (id: string, action: 'pick' | 'remove') => Song | null

  'importer:pickFiles': () => string[]
  'importer:analyse': (paths: string[]) => ImportAnalysis
  'importer:commit': (items: ImportCandidate[]) => ImportResult
  /** files the OS asked us to open (double-clicked .karaokay packages) before the window was ready */
  'importer:takeOpened': () => string[]

  /** ask where to save, then write a .karaokay package; null when cancelled */
  'package:export': (songIds: string[], suggestedName?: string) => ExportResult | null

  'analysis:pending': () => string[]
  'analysis:saveKey': (id: string, key: Pick<SongKey, 'tonic' | 'mode' | 'confidence'>) => void
  'analysis:markFailed': (id: string, reason: string) => void
  'analysis:reset': (id: string) => void

  'queue:get': () => QueueItem[]
  'queue:add': (songIds: string[], where: 'end' | 'next') => QueueItem[]
  'queue:move': (itemId: string, toIndex: number) => QueueItem[]
  'queue:remove': (itemId: string) => QueueItem[]
  'queue:clear': () => QueueItem[]
  'queue:shift': () => { item: QueueItem | null; queue: QueueItem[] }
  'queue:setTranspose': (itemId: string, transpose: number | null) => QueueItem[]
  'queue:replace': (songIds: string[]) => QueueItem[]

  'playlists:list': () => Playlist[]
  'playlists:get': (id: string) => PlaylistDetail | null
  'playlists:create': (name: string, songIds: string[]) => Playlist
  'playlists:rename': (id: string, name: string) => void
  'playlists:delete': (id: string) => void
  'playlists:addSongs': (id: string, songIds: string[]) => void
  'playlists:removeAt': (id: string, position: number) => void
  'playlists:move': (id: string, from: number, to: number) => void

  'history:list': (limit: number) => HistoryEntry[]
  'history:record': (songId: string, transpose: number) => void

  'settings:get': () => Settings
  'settings:set': <K extends keyof Settings>(key: K, value: Settings[K]) => Settings
  'settings:chooseLibraryFolder': () => Settings | null

  'lyrics:modelStatus': () => AlignModelStatus
  'lyrics:align': (text: string, pcm: Float32Array, offsetSec: number) => AlignResult
  /** write lyrics.srt (old file kept as .bak), drop lyrics.txt; `review` marks auto-timed lyrics for checking */
  'lyrics:save': (songId: string, srt: string, opts?: { review?: boolean }) => Song
  /** songs with pasted lyrics and a vocal track, waiting to be timed */
  'lyrics:pending': () => string[]
  /** the pasted lyrics (lyrics.txt) of a song, or null */
  'lyrics:readDraft': (songId: string) => string | null
  'lyrics:markChecked': (songId: string) => Song
  'lyrics:pickAudio': () => { token: string; name: string } | null
}

/** Events pushed from main to renderer. */
export interface EventMap {
  'library:changed': LibraryChange
  'importer:progress': { done: number; total: number }
  /** bytes written so far while exporting a .karaokay package */
  'package:progress': { done: number; total: number }
  /** the OS asked us to open files (e.g. a double-clicked .karaokay) */
  'menu:openFiles': string[]
  'menu:import': void
  'menu:settings': void
  'lyrics:progress': AlignProgress
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

export const INVOKE_PREFIXES = ['library:', 'importer:', 'analysis:', 'queue:', 'playlists:', 'history:', 'settings:', 'lyrics:', 'package:']

export const MEDIA_SCHEME = 'karaokay-media'

/** karaokay-media://song/<id>/<role>?v=<cacheBuster> */
export type MediaRole = 'instrumental' | 'vocals' | 'lyrics' | 'cover' | 'video'
/** a file the user picked in a dialog this session (e.g. an original recording for lyric alignment) */
export function pickedUrl(token: string): string {
  return `${MEDIA_SCHEME}://picked/${encodeURIComponent(token)}`
}

export function mediaUrl(songId: string, role: MediaRole, v?: string | number): string {
  return `${MEDIA_SCHEME}://song/${encodeURIComponent(songId)}/${role}${v !== undefined ? `?v=${v}` : ''}`
}

export interface PreloadApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: Parameters<InvokeMap[C]>): Promise<Awaited<ReturnType<InvokeMap[C]>>>
  on<E extends EventChannel>(event: E, cb: (payload: EventMap[E]) => void): () => void
  pathForFile(file: File): string
  platform: string
}
