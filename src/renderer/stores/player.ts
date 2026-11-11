import { create } from 'zustand'
import type { Cue, QueueItem, Settings, Song } from '../../shared/types'
import { parseSrt } from '../../shared/srt'
import { clampTranspose } from '../../shared/keys'
import { api } from '../api'
import { engine, type EngineState } from '../audio/engine'
import { useUi } from './ui'

interface Interstitial {
  song: Song
  endsAt: number
}

interface PlayerState {
  settings: Settings | null
  queue: QueueItem[]
  current: Song | null
  cues: Cue[]
  state: EngineState
  transpose: number
  vocalLevel: number
  volume: number
  duration: number
  interstitial: Interstitial | null
  init: () => Promise<void>
  setQueue: (q: QueueItem[]) => void
  enqueue: (songIds: string[], where: 'end' | 'next') => Promise<void>
  playNow: (songId: string) => Promise<void>
  playQueueItem: (item: QueueItem) => Promise<void>
  skip: () => Promise<void>
  restart: () => void
  toggle: () => void
  seek: (t: number) => void
  seekBy: (d: number) => void
  setTranspose: (n: number) => void
  stepTranspose: (d: number) => void
  setVocalLevel: (v: number) => void
  toggleVocal: () => void
  setVolume: (v: number) => void
  nudgeLyrics: (ms: number) => void
  startInterstitialNow: () => void
  cancelInterstitial: () => void
  stop: () => void
  updateSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<void>
  onSongUpdated: (song: Song) => void
}

let interTimer: number | null = null
let saveTranspose: number | null = null
let saveVocal: number | null = null
let saveVolume: number | null = null
let saveOffset: number | null = null
let lastVocalOn = 0.3
let startedAt = 0
let recorded = false

function debounce(prev: number | null, ms: number, fn: () => void): number {
  if (prev) clearTimeout(prev)
  return window.setTimeout(fn, ms)
}

export const usePlayer = create<PlayerState>((set, get) => {
  /** Record the current song in history once it has really been sung (ended, or 30 s+). */
  const recordIfSung = (force = false): void => {
    const cur = get().current
    if (!cur || recorded) return
    if (force || engine.position > 30) {
      recorded = true
      void api.invoke('history:record', cur.id, get().transpose)
    }
  }

  const startSong = async (song: Song, itemTranspose: number | null): Promise<void> => {
    const s = get().settings
    const transpose = clampTranspose(itemTranspose ?? song.transpose)
    const vocalLevel = song.guideVocalLevel ?? s?.defaultGuideVocal ?? 0.3
    if (vocalLevel > 0) lastVocalOn = vocalLevel
    recorded = false
    startedAt = Date.now()
    set({ current: song, cues: [], transpose, vocalLevel, interstitial: null, duration: song.durationMs / 1000 })
    if (s?.focusOnPlay) useUi.getState().setFocus(true)
    const lyrics = song.hasLyrics ? api.invoke('library:readLyrics', song.id) : Promise.resolve(null)
    try {
      await engine.load(song, { transpose, vocalLevel })
      if (get().current?.id !== song.id) return
      const text = await lyrics
      set({ cues: text ? parseSrt(text) : [], duration: engine.duration })
      await engine.play()
    } catch (e) {
      if (get().current?.id !== song.id) return
      useUi.getState().toast(`Couldn't play “${song.title}”: ${e instanceof Error ? e.message : e}. Skipping.`, 'error', 6000)
      setTimeout(() => void get().skip(), 3000)
    }
  }

  const advance = async (): Promise<void> => {
    const { item, queue } = await api.invoke('queue:shift')
    set({ queue })
    if (item) await startSong(item.song, item.transpose)
    else {
      engine.unload()
      set({ current: null, cues: [], interstitial: null })
    }
  }

  const onEnded = (): void => {
    recordIfSung(true)
    const q = get().queue
    const secs = get().settings?.interstitialSeconds ?? 8
    if (q.length === 0) {
      set({ interstitial: null })
      return
    }
    if (secs <= 0) {
      void advance()
      return
    }
    const next = q.find((i) => !i.song.missing)
    if (!next) return
    set({ interstitial: { song: next.song, endsAt: Date.now() + secs * 1000 } })
    if (interTimer) clearTimeout(interTimer)
    interTimer = window.setTimeout(() => {
      interTimer = null
      if (get().interstitial) void advance()
    }, secs * 1000)
  }

  return {
    settings: null,
    queue: [],
    current: null,
    cues: [],
    state: 'idle',
    transpose: 0,
    vocalLevel: 0.3,
    volume: 0.85,
    duration: 0,
    interstitial: null,

    init: async () => {
      const [settings, queue] = await Promise.all([api.invoke('settings:get'), api.invoke('queue:get')])
      set({ settings, queue, volume: settings.volume })
      lastVocalOn = settings.defaultGuideVocal || 0.3
      engine.setVolume(settings.volume)
      engine.on(() => set({ state: engine.state, duration: engine.duration || get().duration }))
      engine.onEnded(onEnded)
      // preload the next song during the last 30 s
      window.setInterval(() => {
        const cur = get().current
        const next = get().queue[0]
        if (cur && next && engine.isPlaying && engine.duration - engine.position < 30) void engine.prepare(next.song).catch(() => undefined)
        if (cur && engine.isPlaying && !recorded && engine.position > 30) recordIfSung()
      }, 1000)
    },

    setQueue: (queue) => set({ queue }),

    enqueue: async (songIds, where) => {
      const queue = await api.invoke('queue:add', songIds, where)
      set({ queue })
      // nothing playing: start right away
      if (!get().current) await advance()
      else if (where === 'next' && engine.duration - engine.position < 30) void engine.prepare(queue[0].song).catch(() => undefined)
    },

    playNow: async (songId) => {
      const song = await api.invoke('library:get', songId)
      if (!song) return
      recordIfSung()
      if (engine.isPlaying) await engine.fadeOut(250)
      await startSong(song, null)
    },

    playQueueItem: async (item) => {
      const queue = await api.invoke('queue:remove', item.id)
      set({ queue })
      recordIfSung()
      if (engine.isPlaying) await engine.fadeOut(250)
      await startSong(item.song, item.transpose)
    },

    skip: async () => {
      if (interTimer) clearTimeout(interTimer)
      recordIfSung()
      if (engine.isPlaying) await engine.fadeOut(300)
      await advance()
    },

    restart: () => {
      engine.seek(0)
      if (!engine.isPlaying) void engine.play()
    },

    toggle: () => {
      const s = get()
      if (s.interstitial) {
        s.startInterstitialNow()
        return
      }
      if (!s.current) {
        if (s.queue.length) void advance()
        return
      }
      engine.toggle()
    },

    seek: (t) => engine.seek(t),
    seekBy: (d) => engine.seek(engine.position + d),

    setTranspose: (n) => {
      const t = clampTranspose(n)
      set({ transpose: t })
      engine.setTranspose(t)
      const cur = get().current
      if (!cur) return
      saveTranspose = debounce(saveTranspose, 2000, () => {
        void api.invoke('library:update', cur.id, { transpose: t }).then((song) => get().onSongUpdated(song))
      })
    },
    stepTranspose: (d) => get().setTranspose(get().transpose + d),

    setVocalLevel: (v) => {
      const level = Math.max(0, Math.min(1, v))
      if (level > 0) lastVocalOn = level
      set({ vocalLevel: level })
      engine.setVocalLevel(level)
      const cur = get().current
      if (!cur) return
      saveVocal = debounce(saveVocal, 1500, () => {
        void api.invoke('library:update', cur.id, { guideVocalLevel: level }).then((song) => get().onSongUpdated(song))
      })
    },
    toggleVocal: () => get().setVocalLevel(get().vocalLevel > 0 ? 0 : lastVocalOn || 0.3),

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v))
      set({ volume })
      engine.setVolume(volume)
      saveVolume = debounce(saveVolume, 800, () => void get().updateSetting('volume', volume))
    },

    nudgeLyrics: (ms) => {
      const cur = get().current
      if (!cur) return
      const lyricsOffsetMs = Math.max(-10000, Math.min(10000, cur.lyricsOffsetMs + ms))
      set({ current: { ...cur, lyricsOffsetMs } })
      saveOffset = debounce(saveOffset, 1000, () => {
        void api.invoke('library:update', cur.id, { lyricsOffsetMs }).then((song) => get().onSongUpdated(song))
      })
    },

    startInterstitialNow: () => {
      if (interTimer) clearTimeout(interTimer)
      interTimer = null
      void advance()
    },
    cancelInterstitial: () => {
      if (interTimer) clearTimeout(interTimer)
      interTimer = null
      set({ interstitial: null })
    },

    stop: () => {
      recordIfSung()
      engine.unload()
      set({ current: null, cues: [], interstitial: null })
    },

    updateSetting: async (k, v) => {
      const settings = await api.invoke('settings:set', k, v)
      set({ settings })
    },

    onSongUpdated: (song) => {
      const cur = get().current
      if (cur && cur.id === song.id) {
        // keep live values the user may still be changing
        set({ current: { ...song, lyricsOffsetMs: cur.lyricsOffsetMs === song.lyricsOffsetMs ? song.lyricsOffsetMs : cur.lyricsOffsetMs } })
        if (song.hasLyrics !== cur.hasLyrics || song.folder !== cur.folder) {
          void api.invoke('library:readLyrics', song.id).then((t) => set({ cues: t ? parseSrt(t) : [] }))
        }
      }
      set({ queue: get().queue.map((q) => (q.songId === song.id ? { ...q, song } : q)) })
    }
  }
})

export function elapsedSinceStart(): number {
  return (Date.now() - startedAt) / 1000
}
