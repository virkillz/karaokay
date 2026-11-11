import type { Song } from '../../shared/types'
import { api } from '../api'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { useLibrary } from '../stores/library'

export async function addToQueue(songs: Song[], where: 'end' | 'next' = 'end'): Promise<void> {
  const playable = songs.filter((s) => !s.missing)
  if (playable.length === 0) {
    useUi.getState().toast('That song’s files are missing.', 'error')
    return
  }
  const wasIdle = !usePlayer.getState().current
  await usePlayer.getState().enqueue(
    playable.map((s) => s.id),
    where
  )
  if (!wasIdle) {
    const label = playable.length === 1 ? `“${playable[0].title}”` : `${playable.length} songs`
    useUi.getState().toast(where === 'next' ? `${label} plays next` : `Added ${label} to the queue`, 'ok', 2200)
  }
}

export async function playNow(song: Song): Promise<void> {
  if (song.missing) return
  await usePlayer.getState().playNow(song.id)
}

export async function toggleFavorite(song: Song): Promise<void> {
  await api.invoke('library:setFavorite', song.id, !song.favorite)
  useLibrary.getState().patchSong({ ...song, favorite: !song.favorite })
  useLibrary.setState({ version: useLibrary.getState().version + 1 })
}

/** Save songs as a .karaokay package (main asks where, and whether to include videos). */
export async function exportSongs(songIds: string[], name?: string): Promise<void> {
  const ui = useUi.getState()
  if (songIds.length === 0) return
  const id = ui.toast(`Exporting ${songIds.length === 1 ? 'song' : `${songIds.length} songs`}…`, 'info', 0)
  const off = api.on('package:progress', (p) => ui.updateToast(id, { progress: p.total ? p.done / p.total : 0 }))
  try {
    const r = await api.invoke('package:export', songIds, name)
    ui.dismissToast(id)
    if (!r) return
    const file = r.file.split(/[\\/]/).pop()
    ui.toast(`Exported ${r.exported === 1 ? '1 song' : `${r.exported} songs`} to “${file}”`, 'ok', 4000)
    for (const s of r.skipped) ui.toast(`Left out ${s.name}: ${s.reason}`, 'error', 8000)
  } catch (e) {
    ui.dismissToast(id)
    ui.toast(`Export failed: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e}`, 'error', 8000)
  } finally {
    off()
  }
}

export function newPlaylistFrom(songIds: string[]): void {
  useUi.getState().set({
    prompt: {
      title: 'New playlist',
      label: 'Name',
      value: '',
      onSubmit: async (name) => {
        const p = await api.invoke('playlists:create', name || 'New playlist', songIds)
        await useLibrary.getState().refreshPlaylists()
        useUi.getState().toast(`Saved “${p.name}”`, 'ok', 2500)
      }
    }
  })
}

export function openSongMenu(e: React.MouseEvent, song: Song, extra?: { label: string; run: () => void; danger?: boolean }[]): void {
  e.preventDefault()
  e.stopPropagation()
  void useLibrary.getState().refreshPlaylists()
  useUi.getState().set({ ctx: { x: e.clientX, y: e.clientY, song, extra } })
}
