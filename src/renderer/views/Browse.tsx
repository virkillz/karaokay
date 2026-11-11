import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry, NameCount, PlaylistDetail, Song } from '../../shared/types'
import { formatTranspose } from '../../shared/keys'
import { api } from '../api'
import { useLibrary } from '../stores/library'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { Cover, formatDuration } from '../components/common'
import { SongRow } from '../components/SongRow'
import { IconBack } from '../components/icons'
import { addToQueue, exportSongs } from '../components/songActions'

const TINTS = ['#FFFFFF', '#FFE3EF', '#FFF3B8', '#D6F7F2', '#EDE7FF']
const TILTS = ['rotate(-1deg)', 'none', 'rotate(1deg)', 'none', 'rotate(-0.6deg)']

function SongList({ songs, emptyText, extra, menuExtra }: { songs: Song[]; emptyText: string; extra?: (s: Song, i: number) => string | undefined; menuExtra?: (s: Song, i: number) => { label: string; run: () => void; danger?: boolean }[] }) {
  const currentId = usePlayer((s) => s.current?.id)
  if (songs.length === 0) return <div className="card empty-note">{emptyText}</div>
  return (
    <div className="card list-card">
      {songs.map((s, i) => (
        <SongRow key={`${s.id}-${i}`} song={s} className="static" playing={s.id === currentId} extra={extra?.(s, i)} menuExtra={menuExtra?.(s, i)} />
      ))}
    </div>
  )
}

function useSongs(query: Parameters<typeof api.invoke<'library:search'>>[1] | null): Song[] {
  const version = useLibrary((s) => s.version)
  const [songs, setSongs] = useState<Song[]>([])
  const key = JSON.stringify(query)
  useEffect(() => {
    if (!query) return
    let live = true
    void api.invoke('library:search', query).then((r) => live && setSongs(r.songs))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])
  return songs
}

function CoverFor({ item }: { item: NameCount }) {
  const fake = item.coverSongId ? { id: item.coverSongId, title: item.name, hasCover: true, folder: '' } : { id: item.name, title: item.name, hasCover: false, folder: '' }
  return <Cover song={fake} />
}

function TileGrid({ items, onPick, suffix }: { items: NameCount[]; onPick: (n: string) => void; suffix: (n: NameCount) => string }) {
  return (
    <ul className="tile-grid">
      {items.map((a, i) => (
        <li key={a.name} data-letter={a.name[0]?.toUpperCase()}>
          <button className="tile" style={{ background: TINTS[i % 5], transform: TILTS[i % 5] }} onClick={() => onPick(a.name)}>
            <CoverFor item={a} />
            <div style={{ minWidth: 0 }}>
              <div className="n">{a.name}</div>
              <div className="c">{suffix(a)}</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

function DrillHeader({ title, count, onBack, songs }: { title: string; count: number; onBack: () => void; songs: Song[] }) {
  return (
    <div className="browse-head">
      <button className="icon-btn sm" aria-label="Back" onClick={onBack}>
        <IconBack />
      </button>
      <h1>{title}</h1>
      <span className="pill white">{count}</span>
      <span className="grow" />
      <button className="btn" disabled={songs.length === 0} onClick={() => void addToQueue(songs)}>
        Queue all
      </button>
    </div>
  )
}

export function ArtistsView() {
  const artists = useLibrary((s) => s.artists)
  const artist = useUi((s) => s.browseArtist)
  const set = useUi((s) => s.set)
  const songs = useSongs(artist ? { artist, sort: 'title', limit: 5000 } : null)
  const letters = useMemo(() => new Set(artists.map((a) => (/[A-Z]/i.test(a.name[0] ?? '') ? a.name[0].toUpperCase() : '#'))), [artists])
  if (artist) {
    return (
      <div className="browse">
        <DrillHeader title={artist} count={songs.length} songs={songs} onBack={() => set({ browseArtist: null })} />
        <SongList songs={songs} emptyText="No songs." />
      </div>
    )
  }
  const jump = (l: string): void => {
    const el = [...document.querySelectorAll<HTMLElement>('[data-letter]')].find((e) => (l === '#' ? !/[A-Z]/.test(e.dataset.letter ?? '') : e.dataset.letter === l))
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>Artists</h1>
        <span className="pill white">{artists.length}</span>
        <span className="grow" />
        <div className="letters" role="group" aria-label="Jump to letter">
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('').map((l) => (
            <button key={l} disabled={!letters.has(l)} onClick={() => jump(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {artists.length === 0 ? <div className="card empty-note">No artists yet.</div> : <TileGrid items={artists} onPick={(n) => set({ browseArtist: n })} suffix={(a) => `${a.count} song${a.count === 1 ? '' : 's'}`} />}
    </div>
  )
}

export function GenresView() {
  const genres = useLibrary((s) => s.genres)
  const genre = useUi((s) => s.browseGenre)
  const set = useUi((s) => s.set)
  const songs = useSongs(genre ? { genre, sort: 'artist', limit: 5000 } : null)
  if (genre) {
    return (
      <div className="browse">
        <DrillHeader title={genre} count={songs.length} songs={songs} onBack={() => set({ browseGenre: null })} />
        <SongList songs={songs} emptyText="No songs." />
      </div>
    )
  }
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>Genres</h1>
        <span className="pill white">{genres.length}</span>
      </div>
      {genres.length === 0 ? <div className="card empty-note">No genres yet. Set a genre in a song’s details.</div> : <TileGrid items={genres} onPick={(n) => set({ browseGenre: n })} suffix={(g) => `${g.count} song${g.count === 1 ? '' : 's'}`} />}
    </div>
  )
}

export function FavoritesView() {
  const songs = useSongs({ favorite: true, sort: 'artist', limit: 5000 })
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>Favorites</h1>
        <span className="pill white">{songs.length}</span>
        <span className="grow" />
        <button className="btn" disabled={songs.length === 0} onClick={() => void addToQueue(songs)}>
          Queue all
        </button>
      </div>
      <SongList songs={songs} emptyText="No favourites yet. Right-click a song and choose Favorite." />
    </div>
  )
}

export function HistoryView() {
  const version = useLibrary((s) => s.version)
  const current = usePlayer((s) => s.current?.id)
  const [items, setItems] = useState<HistoryEntry[]>([])
  useEffect(() => {
    void api.invoke('history:list', 300).then(setItems)
  }, [version, current])
  const when = (iso: string): string => {
    const d = new Date(iso)
    const today = new Date()
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return d.toDateString() === today.toDateString() ? `today ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
  }
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>History</h1>
        <span className="pill white">{items.length}</span>
      </div>
      <SongList
        songs={items.map((h) => h.song)}
        emptyText="Songs you sing show up here."
        extra={(_s, i) => `${when(items[i].playedAt)}${items[i].transpose ? ` · key ${formatTranspose(items[i].transpose!)}` : ''}`}
      />
    </div>
  )
}

export function PlaylistsView() {
  const playlists = useLibrary((s) => s.playlists)
  const refresh = useLibrary((s) => s.refreshPlaylists)
  const version = useLibrary((s) => s.version)
  const selected = useUi((s) => s.playlistId)
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const setQueue = usePlayer((s) => s.setQueue)
  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const id = selected ?? playlists[0]?.id ?? null

  useEffect(() => {
    void refresh()
  }, [refresh, version])
  const load = async (): Promise<void> => setDetail(id ? await api.invoke('playlists:get', id) : null)
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, version, playlists])

  return (
    <div className="browse">
      <div className="browse-head">
        <h1>Playlists</h1>
        <span className="pill white">{playlists.length}</span>
        <span className="grow" />
        <button
          className="btn primary"
          onClick={() =>
            set({
              prompt: {
                title: 'New playlist',
                label: 'Name',
                value: '',
                onSubmit: async (name) => {
                  const p = await api.invoke('playlists:create', name || 'New playlist', [])
                  await refresh()
                  set({ playlistId: p.id })
                }
              }
            })
          }
        >
          New playlist
        </button>
      </div>
      {playlists.length === 0 ? (
        <div className="card empty-note">No playlists yet. Build a queue and press “Save as playlist”, or make one here.</div>
      ) : (
        <div className="pl-grid">
          <nav className="card pl-list" aria-label="Playlists">
            {playlists.map((p) => (
              <button key={p.id} className={p.id === id ? 'on' : ''} onClick={() => set({ playlistId: p.id })}>
                <span className="display" style={{ fontWeight: 700, fontSize: 17 }}>
                  {p.name}
                </span>
                <span className="c">
                  {p.count} songs · {formatDuration(p.durationMs)}
                </span>
              </button>
            ))}
          </nav>
          {detail && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div className="browse-head">
                <h1 style={{ fontSize: 26 }}>{detail.name}</h1>
                <span className="grow" />
                <button
                  className="btn sun shadow"
                  disabled={detail.songs.length === 0}
                  onClick={async () => {
                    setQueue(await api.invoke('queue:replace', detail.songs.filter((s) => !s.missing).map((s) => s.id)))
                    usePlayer.getState().stop()
                    usePlayer.getState().toggle()
                    set({ view: 'sing' })
                  }}
                >
                  Play
                </button>
                <button className="btn" disabled={detail.songs.length === 0} onClick={() => void addToQueue(detail.songs)}>
                  Queue all
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    set({
                      prompt: {
                        title: 'Rename playlist',
                        label: 'Name',
                        value: detail.name,
                        onSubmit: async (name) => {
                          if (name) await api.invoke('playlists:rename', detail.id, name)
                          await refresh()
                        }
                      }
                    })
                  }
                >
                  Rename
                </button>
                <button className="btn" disabled={detail.songs.length === 0} onClick={() => void exportSongs(detail.songs.filter((s) => !s.missing).map((s) => s.id), detail.name)}>
                  Export…
                </button>
                <button
                  className="btn ghost"
                  onClick={async () => {
                    await api.invoke('playlists:delete', detail.id)
                    set({ playlistId: null })
                    await refresh()
                    toast(`Deleted “${detail.name}”`, 'info', 2500)
                  }}
                >
                  Delete
                </button>
              </div>
              <SongList
                songs={detail.songs}
                emptyText="This playlist is empty. Right-click any song and choose Add to playlist."
                menuExtra={(_s, i) => [
                  { label: 'Move up', run: async () => { if (i > 0) { await api.invoke('playlists:move', detail.id, i, i - 1); await load() } } },
                  { label: 'Move down', run: async () => { if (i < detail.songs.length - 1) { await api.invoke('playlists:move', detail.id, i, i + 1); await load() } } },
                  { label: 'Remove from playlist', danger: true, run: async () => { await api.invoke('playlists:removeAt', detail.id, i); await refresh() } }
                ]}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
