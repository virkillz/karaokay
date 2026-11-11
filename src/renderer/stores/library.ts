import { create } from 'zustand'
import type { NameCount, Playlist, Song, SortKey } from '../../shared/types'
import { api } from '../api'

interface LibraryState {
  text: string
  genre: string | null
  hasVocals: boolean
  hasLyrics: boolean
  sort: SortKey
  results: Song[]
  total: number
  count: number | null
  genres: NameCount[]
  artists: NameCount[]
  playlists: Playlist[]
  /** bumps whenever library content changes, for views that fetch their own lists */
  version: number
  setText: (t: string) => void
  setFilter: (patch: Partial<Pick<LibraryState, 'genre' | 'hasVocals' | 'hasLyrics' | 'sort'>>) => void
  search: () => Promise<void>
  refreshMeta: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  patchSong: (song: Song) => void
}

let timer: number | null = null
let seq = 0

export const useLibrary = create<LibraryState>((set, get) => ({
  text: '',
  genre: null,
  hasVocals: false,
  hasLyrics: false,
  sort: 'relevance',
  results: [],
  total: 0,
  count: null,
  genres: [],
  artists: [],
  playlists: [],
  version: 0,
  setText: (text) => {
    set({ text })
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(() => void get().search(), 60)
  },
  setFilter: (patch) => {
    set(patch)
    void get().search()
  },
  search: async () => {
    const my = ++seq
    const s = get()
    const text = s.text.trim()
    const r = await api.invoke('library:search', {
      text,
      genre: s.genre,
      hasVocals: s.hasVocals,
      hasLyrics: s.hasLyrics,
      // with no search text, show recently added first
      sort: text ? s.sort : s.sort === 'relevance' ? 'added' : s.sort,
      limit: 2000
    })
    if (my === seq) set({ results: r.songs, total: r.total })
  },
  refreshMeta: async () => {
    const [count, genres, artists] = await Promise.all([
      api.invoke('library:count'),
      api.invoke('library:genres'),
      api.invoke('library:artists')
    ])
    set({ count, genres, artists, version: get().version + 1 })
  },
  refreshPlaylists: async () => set({ playlists: await api.invoke('playlists:list') }),
  patchSong: (song) => set({ results: get().results.map((s) => (s.id === song.id ? song : s)) })
}))
