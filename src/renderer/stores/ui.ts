import { create } from 'zustand'
import type { Cue, ImportCandidate, Song } from '../../shared/types'
import type { CueFlag } from '../lyrics/editCues'

export type View = 'sing' | 'artists' | 'genres' | 'playlists' | 'favorites' | 'history' | 'settings'

export interface Toast {
  id: number
  kind: 'info' | 'ok' | 'error'
  text: string
  progress?: number
}

export interface CtxMenu {
  x: number
  y: number
  song: Song
  /** extra actions supplied by the caller (e.g. remove from playlist) */
  extra?: { label: string; run: () => void; danger?: boolean }[]
}

interface UiState {
  view: View
  focus: boolean
  /** search overlay shown on top of Focus mode */
  searchOverlay: boolean
  /** artist / genre / playlist drill-down within browse views */
  browseArtist: string | null
  browseGenre: string | null
  playlistId: string | null
  importOpen: boolean
  importLoading: boolean
  candidates: ImportCandidate[]
  detailsSongId: string | null
  /** song whose lyrics are being created from pasted text */
  lyricsSongId: string | null
  /** SRT editor; `seed` (file times) replaces the saved lyrics, e.g. fresh alignment results */
  editor: { songId: string; seed?: { cues: Cue[]; flags: CueFlag[] } } | null
  ctx: CtxMenu | null
  toasts: Toast[]
  prompt: { title: string; label: string; value: string; onSubmit: (v: string) => void } | null
  setView: (v: View) => void
  setFocus: (f: boolean) => void
  toast: (text: string, kind?: Toast['kind'], ms?: number) => number
  updateToast: (id: number, patch: Partial<Toast>) => void
  dismissToast: (id: number) => void
  set: (patch: Partial<UiState>) => void
}

let toastSeq = 0

export const useUi = create<UiState>((set, get) => ({
  view: 'sing',
  focus: false,
  searchOverlay: false,
  browseArtist: null,
  browseGenre: null,
  playlistId: null,
  importOpen: false,
  importLoading: false,
  candidates: [],
  detailsSongId: null,
  lyricsSongId: null,
  editor: null,
  ctx: null,
  toasts: [],
  prompt: null,
  setView: (view) => set({ view, focus: false, ctx: null, searchOverlay: false }),
  setFocus: (focus) => set({ focus, searchOverlay: false, view: focus ? 'sing' : get().view }),
  toast: (text, kind = 'info', ms = 4000) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, text }] })
    if (ms > 0) setTimeout(() => get().dismissToast(id), ms)
    return id
  },
  updateToast: (id, patch) => set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  set: (patch) => set(patch)
}))
