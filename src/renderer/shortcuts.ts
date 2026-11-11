import { useEffect } from 'react'
import { usePlayer } from './stores/player'
import { useUi } from './stores/ui'
import { focusSearch } from './components/SearchCard'
import { pickAndImport } from './components/Dialogs'

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/** Global keyboard shortcuts (docs/DESIGN.md §12.4). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ui = useUi.getState()
      const p = usePlayer.getState()
      const mod = e.metaKey || e.ctrlKey
      // always available
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (ui.view === 'sing' && ui.focus) ui.set({ searchOverlay: true })
        else focusSearch()
        return
      }
      if (mod && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        void pickAndImport()
        return
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        ui.setView('settings')
        return
      }
      if (e.key === 'Escape') {
        if (ui.ctx || ui.prompt || ui.importOpen || ui.detailsSongId || ui.lyricsSongId || ui.editor) return
        if (ui.searchOverlay) ui.set({ searchOverlay: false })
        else if (document.fullscreenElement) void document.exitFullscreen()
        else if (ui.focus) ui.setFocus(false)
        return
      }
      if (typing(e) || ui.importOpen || ui.detailsSongId || ui.lyricsSongId || ui.editor || ui.prompt || ui.searchOverlay) return
      if (mod && e.key === 'ArrowRight') {
        e.preventDefault()
        void p.skip()
        return
      }
      if (mod && e.key === 'ArrowLeft') {
        e.preventDefault()
        p.restart()
        return
      }
      if (mod || e.altKey) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          p.toggle()
          break
        case 'n':
        case 'N':
          void p.skip()
          break
        case 'r':
        case 'R':
          p.restart()
          break
        case 'ArrowLeft':
          e.preventDefault()
          p.seekBy(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          p.seekBy(5)
          break
        case 'ArrowUp':
          if (ui.focus) {
            e.preventDefault()
            p.setVolume(p.volume + 0.05)
          }
          break
        case 'ArrowDown':
          if (ui.focus) {
            e.preventDefault()
            p.setVolume(p.volume - 0.05)
          }
          break
        case '[':
          p.stepTranspose(-1)
          break
        case ']':
          p.stepTranspose(1)
          break
        case '\\':
          p.setTranspose(0)
          break
        case 'v':
        case 'V':
          p.toggleVocal()
          break
        case ',':
          p.nudgeLyrics(-50)
          break
        case '.':
          p.nudgeLyrics(50)
          break
        case 'l':
        case 'L':
          ui.setFocus(!(ui.view === 'sing' && ui.focus))
          break
        case 'f':
        case 'F':
          if (document.fullscreenElement) void document.exitFullscreen()
          else void document.documentElement.requestFullscreen()
          break
        case '/':
          e.preventDefault()
          if (ui.view === 'sing' && ui.focus) ui.set({ searchOverlay: true })
          else focusSearch()
          break
      }
    }
    window.addEventListener('keydown', onKey)

    // media keys
    const ms = navigator.mediaSession
    if (ms) {
      ms.setActionHandler('play', () => usePlayer.getState().toggle())
      ms.setActionHandler('pause', () => usePlayer.getState().toggle())
      ms.setActionHandler('nexttrack', () => void usePlayer.getState().skip())
      ms.setActionHandler('previoustrack', () => usePlayer.getState().restart())
    }
    const unsub = usePlayer.subscribe((s, prev) => {
      if (!ms || s.current === prev.current) return
      ms.metadata = s.current ? new MediaMetadata({ title: s.current.title, artist: s.current.artist, album: 'Karaokay' }) : null
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      unsub()
    }
  }, [])
}
