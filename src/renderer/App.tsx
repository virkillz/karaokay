import { useEffect, useState } from 'react'
import { api } from './api'
import { runKeyQueue } from './analysis/keyQueue'
import { runAlignQueue } from './analysis/alignQueue'
import { useLibrary } from './stores/library'
import { usePlayer } from './stores/player'
import { useUi, type View } from './stores/ui'
import { SingPanel, LyricsStrip } from './components/SingPanel'
import { SearchCard, focusSearch } from './components/SearchCard'
import { QueueCard } from './components/QueueCard'
import { ContextMenu, ImportDialog, PromptDialog, SongDetailsDialog, Toasts, pickAndImport, startImport } from './components/Dialogs'
import { IconSettings, IconUpload } from './components/icons'
import { ArtistsView, FavoritesView, GenresView, HistoryView, PlaylistsView } from './views/Browse'
import { SettingsView } from './views/Settings'
import { useShortcuts } from './shortcuts'
import { LyricsDialog } from './components/LyricsDialog'
import { SrtEditor } from './components/SrtEditor'
import mascot from './assets/mascot.webp'
import boombox from './assets/boombox.webp'
import star from './assets/star.webp'
import note from './assets/note.webp'
import heart from './assets/heart.webp'
import { selfTest } from './dev/selftest'
import { engine } from './audio/engine'

// development self-test hook (see src/renderer/dev/selftest.ts); only reachable from devtools or KARAOKAY_SNAPSHOT_SCRIPT
;(window as unknown as Record<string, unknown>).__karaokaySelfTest = selfTest
;(window as unknown as Record<string, unknown>).__karaokay = { usePlayer, useUi, useLibrary, engine }

const NAV: { id: View; label: string }[] = [
  { id: 'sing', label: 'Sing' },
  { id: 'artists', label: 'Artists' },
  { id: 'genres', label: 'Genres' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'history', label: 'History' }
]

function Header() {
  const view = useUi((s) => s.view)
  const focus = useUi((s) => s.focus)
  const set = useUi((s) => s.set)
  const setView = useUi((s) => s.setView)
  const text = useLibrary((s) => s.text)
  const setText = useLibrary((s) => s.setText)
  return (
    <header className="header">
      <div className="logo">
        <img src={mascot} alt="" />
        <span>
          kara<b>okay</b>
        </span>
      </div>
      <nav className="nav" aria-label="Sections">
        {NAV.map((n) => (
          <button
            key={n.id}
            className={view === n.id && !(focus && n.id !== 'sing') ? 'on' : ''}
            aria-current={view === n.id ? 'page' : undefined}
            onClick={() => {
              setView(n.id)
              if (n.id === 'artists') set({ browseArtist: null })
              if (n.id === 'genres') set({ browseGenre: null })
            }}
          >
            {n.label}
          </button>
        ))}
      </nav>
      {view !== 'sing' && (
        <label className="header-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            placeholder="Search songs, artists, lyrics…"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setView('sing')
              setTimeout(focusSearch, 10)
            }}
          />
          <kbd>⌘K</kbd>
        </label>
      )}
      <span className="spacer" />
      <button className="btn primary" onClick={() => void pickAndImport()} title="Import songs  ⌘I">
        <IconUpload />
        Import songs
      </button>
      <button className={`icon-btn shadow ${view === 'settings' ? 'sun' : ''}`} aria-label="Settings" title="Settings  ⌘," onClick={() => setView('settings')}>
        <IconSettings />
      </button>
    </header>
  )
}

function EmptyLibrary() {
  return (
    <div className="empty-lib">
      <section className="dropzone" aria-label="Empty library">
        <img className="sticker" src={star} alt="" style={{ left: 40, top: 40, width: 72, transform: 'rotate(-14deg)' }} />
        <img className="sticker" src={note} alt="" style={{ right: 50, top: 70, width: 66, transform: 'rotate(12deg)' }} />
        <img className="sticker" src={heart} alt="" style={{ right: 70, bottom: 60, width: 58, transform: 'rotate(-8deg)' }} />
        <img className="boombox" src={boombox} alt="" />
        <h1>
          Drop your karaoke
          <br />
          files here
        </h1>
        <p>MP3, WAV or FLAC instrumentals, an optional vocal track, lyrics (SRT, LRC, or paste them in) and an optional background video. Drop whole folders and we'll match them up, or drop a .karaokay file.</p>
        <button className="btn primary" style={{ height: 52, fontSize: 16, padding: '0 26px' }} onClick={() => void pickAndImport()}>
          <IconUpload />
          Choose files…
        </button>
        <div className="convention">
          <div style={{ fontWeight: 900 }}>Each song becomes one folder:</div>
          <code>{'Nora Vale - After Midnight/\n  instrumental.flac   vocals.flac\n  lyrics.srt          song.json'}</code>
        </div>
      </section>
    </div>
  )
}

function SearchOverlay() {
  const open = useUi((s) => s.view === 'sing' && s.focus && s.searchOverlay)
  const set = useUi((s) => s.set)
  useEffect(() => {
    if (open) setTimeout(() => window.dispatchEvent(new Event('karaokay:focus-search')), 20)
  }, [open])
  if (!open) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && set({ searchOverlay: false })} onKeyDown={(e) => e.key === 'Escape' && set({ searchOverlay: false })}>
      <div style={{ width: 'min(760px, 100%)', height: 'min(640px, 100%)', display: 'flex' }}>
        <SearchCard />
      </div>
    </div>
  )
}

function DropOverlay() {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overH = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setOver(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      const paths = files.map((f) => api.pathForFile(f)).filter(Boolean)
      void startImport(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overH)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overH)
      window.removeEventListener('drop', drop)
    }
  }, [])
  if (!over) return null
  return (
    <div className="drop-overlay">
      <div className="box">
        <img src={boombox} alt="" />
        <h2>Drop to import</h2>
      </div>
    </div>
  )
}

export function App() {
  const view = useUi((s) => s.view)
  const focus = useUi((s) => s.focus)
  const count = useLibrary((s) => s.count)
  const current = usePlayer((s) => s.current)
  const queueLen = usePlayer((s) => s.queue.length)
  useShortcuts()

  useEffect(() => {
    const lib = useLibrary.getState()
    void usePlayer.getState().init()
    void lib.search()
    void lib.refreshMeta()
    void lib.refreshPlaylists()
    void runKeyQueue()
    void runAlignQueue()
    let pending: number | null = null
    const offChanged = api.on('library:changed', (c) => {
      // coalesce bursts (scans, analysis)
      if (pending) clearTimeout(pending)
      pending = window.setTimeout(async () => {
        pending = null
        const l = useLibrary.getState()
        void l.search()
        void l.refreshMeta()
        const p = usePlayer.getState()
        p.setQueue(await api.invoke('queue:get'))
        if (p.current) {
          const fresh = await api.invoke('library:get', p.current.id)
          if (fresh) p.onSongUpdated(fresh)
        }
      }, 150)
      if (c.added.length || c.updated.length) {
        void runKeyQueue()
        void runAlignQueue()
      }
    })
    const offImport = api.on('menu:import', () => void pickAndImport())
    // .karaokay files double-clicked in Finder: those from before launch, then any later ones
    void api.invoke('importer:takeOpened').then((paths) => void startImport(paths))
    const offOpen = api.on('menu:openFiles', (paths) => void startImport(paths))
    const offSettings = api.on('menu:settings', () => useUi.getState().setView('settings'))
    return () => {
      offChanged()
      offImport()
      offOpen()
      offSettings()
    }
  }, [])

  const empty = count === 0 && !current && queueLen === 0
  let main: React.ReactNode
  if (count === null) main = null
  else if (empty && view !== 'settings') main = <EmptyLibrary />
  else if (view === 'sing' && focus)
    main = (
      <div className="focus-layout">
        <SingPanel focus />
      </div>
    )
  else if (view === 'sing')
    main = (
      <div className="sing-layout">
        <SingPanel focus={false} />
        <div className="right-col">
          <SearchCard />
          <QueueCard />
        </div>
      </div>
    )
  else
    main = (
      <>
        <LyricsStrip />
        {view === 'artists' && <ArtistsView />}
        {view === 'genres' && <GenresView />}
        {view === 'playlists' && <PlaylistsView />}
        {view === 'favorites' && <FavoritesView />}
        {view === 'history' && <HistoryView />}
        {view === 'settings' && <SettingsView />}
      </>
    )

  return (
    <div className={`app ${api.platform === 'darwin' ? 'mac' : ''}`}>
      {!(view === 'sing' && focus) && <Header />}
      {view === 'sing' && focus && <div className="header" style={{ height: 30, padding: 0 }} />}
      <main className="main">{main}</main>
      <SearchOverlay />
      <ImportDialog />
      <SongDetailsDialog />
      <LyricsDialog />
      <SrtEditor />
      <PromptDialog />
      <ContextMenu />
      <Toasts />
      <DropOverlay />
    </div>
  )
}
