import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { InvokeChannel, InvokeMap, EventChannel, EventMap } from '../shared/ipc'
import type { SongsRepo } from './db/songs'
import type { HistoryRepo, PlaylistRepo, QueueRepo, SettingsRepo } from './db/repos'
import type { Library } from './library/library'
import type { Importer } from './library/importer'
import type { AlignService } from './align/service'
import type { EditableSongFields } from '../shared/types'
import { clampTranspose } from '../shared/keys'
import { isThemeId } from '../shared/themes'
import { exportSongs } from './library/exporter'
import { PACKAGE_EXT } from './library/karaokayFile'
import { sanitiseFolderName } from './library/grouping'

export interface Services {
  songs: SongsRepo
  queue: QueueRepo
  playlists: PlaylistRepo
  history: HistoryRepo
  settings: SettingsRepo
  library: Library
  importer: Importer
  aligner: AlignService
  /** switch the library root (restarts the watcher and rescans) */
  setLibraryRoot: (root: string) => Promise<void>
  /** files the OS asked us to open before the renderer was listening; drained once */
  takeOpened: () => string[]
}

export function send<E extends EventChannel>(event: E, payload: EventMap[E]): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}

function handle<C extends InvokeChannel>(channel: C, fn: (...args: Parameters<InvokeMap[C]>) => ReturnType<InvokeMap[C]> | Promise<ReturnType<InvokeMap[C]>>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as Parameters<InvokeMap[C]>)))
}

function str(v: unknown, max = 300): string | null {
  return typeof v === 'string' ? v.trim().slice(0, max) || null : null
}

export function registerIpc(s: Services): void {
  // ---- library
  handle('library:search', (q) => s.songs.search(q ?? {}))
  handle('library:get', (id) => s.songs.get(id))
  handle('library:count', () => s.songs.count())
  handle('library:artists', () => s.songs.artists())
  handle('library:genres', () => s.songs.genres())
  handle('library:setFavorite', (id, on) => s.songs.setFavorite(id, on))
  handle('library:readLyrics', async (id) => {
    const file = s.library.filePath(id, 'lyrics')
    if (!file) return null
    return fs.readFile(file, 'utf8').catch(() => null)
  })
  handle('library:setVideo', async (id, action) => {
    const row = s.songs.getRow(id)
    if (!row) throw new Error('song not found')
    const dir = s.library.dirOf(row.folder)
    let src: string | null = null
    if (action === 'pick') {
      const win = BrowserWindow.getFocusedWindow()
      const opts: Electron.OpenDialogOptions = {
        title: 'Choose a background video',
        properties: ['openFile'],
        filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm'] }]
      }
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths[0]) return null
      src = r.filePaths[0]
    }
    for (const n of await fs.readdir(dir)) if (/^background\.(mp4|m4v|mov|webm)$/i.test(n)) await fs.unlink(path.join(dir, n))
    if (src) await fs.copyFile(src, path.join(dir, `background${path.extname(src).toLowerCase()}`))
    await s.library.scanFolder(row.folder, true)
    send('library:changed', { added: [], updated: [id], removed: [] })
    return s.songs.get(id)
  })
  handle('library:rescan', async () => {
    await s.library.scanAll()
  })
  handle('library:reveal', (id) => {
    const file = s.library.filePath(id, 'instrumental')
    if (file) shell.showItemInFolder(file)
  })
  handle('library:remove', async (id, deleteFiles) => {
    const row = s.songs.getRow(id)
    if (!row) return
    if (deleteFiles) await shell.trashItem(s.library.dirOf(row.folder)).catch(() => undefined)
    s.songs.deleteRow(id)
    send('library:changed', { added: [], updated: [], removed: [id] })
  })
  handle('library:update', async (id, patch: Partial<EditableSongFields>) => {
    const f: Record<string, unknown> = {}
    if (patch.title !== undefined) f.title = str(patch.title) ?? 'Untitled'
    if (patch.artist !== undefined) f.artist = str(patch.artist) ?? 'Unknown Artist'
    if (patch.album !== undefined) f.album = str(patch.album)
    if (patch.genre !== undefined) f.genre = str(patch.genre, 60)
    if (patch.language !== undefined) f.language = str(patch.language, 20)
    if (patch.year !== undefined) f.year = typeof patch.year === 'number' && patch.year > 0 && patch.year < 3000 ? Math.round(patch.year) : null
    if (patch.transpose !== undefined) f.transpose = clampTranspose(patch.transpose)
    if (patch.lyricsOffsetMs !== undefined) f.lyrics_offset_ms = Math.max(-10000, Math.min(10000, Math.round(patch.lyricsOffsetMs)))
    if (patch.vocalOffsetMs !== undefined) f.vocal_offset_ms = Math.max(-10000, Math.min(10000, Math.round(patch.vocalOffsetMs)))
    if (patch.videoOffsetMs !== undefined) f.video_offset_ms = Math.max(-600000, Math.min(600000, Math.round(Number(patch.videoOffsetMs) || 0)))
    if (patch.theme !== undefined) f.theme = isThemeId(patch.theme) ? patch.theme : null
    if (patch.guideVocalLevel !== undefined) f.guide_vocal_level = patch.guideVocalLevel === null ? null : Math.max(0, Math.min(1, patch.guideVocalLevel))
    if (patch.key !== undefined) {
      if (patch.key === null) Object.assign(f, { key_tonic: null, key_mode: null, key_source: null, key_confidence: null, analysis_status: 'pending' })
      else
        Object.assign(f, {
          key_tonic: ((Math.round(patch.key.tonic) % 12) + 12) % 12,
          key_mode: patch.key.mode === 'minor' ? 'minor' : 'major',
          key_source: patch.key.source === 'detected' ? 'detected' : 'manual',
          key_confidence: patch.key.confidence ?? null,
          analysis_status: 'done'
        })
    }
    s.songs.updateFields(id, f)
    await s.library.writeJsonFor(id)
    const song = s.songs.get(id)
    if (!song) throw new Error('song not found')
    send('library:changed', { added: [], updated: [id], removed: [] })
    return song
  })

  // ---- importer
  handle('importer:pickFiles', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Import songs',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Karaoke files', extensions: ['karaokay', 'mp3', 'wav', 'flac', 'srt', 'lrc', 'txt', 'jpg', 'jpeg', 'png', 'mp4', 'm4v', 'mov', 'webm'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })
  handle('importer:analyse', (paths) => s.importer.analyse(paths.filter((p) => typeof p === 'string' && path.isAbsolute(p))))
  handle('importer:commit', async (items) => {
    const move = s.settings.getAll().importMode === 'move'
    const r = await s.importer.commit(items, move, (done, total) => send('importer:progress', { done, total }))
    if (r.imported.length) send('library:changed', { added: r.imported, updated: [], removed: [] })
    return r
  })

  handle('importer:takeOpened', () => s.takeOpened())

  // ---- .karaokay packages
  handle('package:export', async (ids, suggestedName) => {
    const rows = (Array.isArray(ids) ? ids : []).map((id) => s.songs.getRow(id)).filter((r) => !!r)
    if (rows.length === 0) throw new Error('no songs to export')
    const win = BrowserWindow.getFocusedWindow()
    let includeVideo = false
    const withVideo = rows.filter((r) => r.video)
    if (withVideo.length) {
      let bytes = 0
      for (const r of withVideo) bytes += (await fs.stat(path.join(s.library.dirOf(r.folder), r.video!)).catch(() => null))?.size ?? 0
      const opts: Electron.MessageBoxOptions = {
        type: 'question',
        message: withVideo.length === 1 && rows.length === 1 ? 'Include the background video?' : `Include background videos (${withVideo.length} of ${rows.length} songs)?`,
        detail: `Videos add about ${Math.max(1, Math.round(bytes / 1048576))} MB to the file.`,
        buttons: ['Include video', 'Leave out video', 'Cancel'],
        defaultId: 1,
        cancelId: 2
      }
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      if (r.response === 2) return null
      includeVideo = r.response === 0
    }
    const name = sanitiseFolderName(
      (typeof suggestedName === 'string' && suggestedName.trim()) || (rows.length === 1 ? `${rows[0].artist} - ${rows[0].title}` : `Karaokay songs (${rows.length})`)
    )
    const saveOpts: Electron.SaveDialogOptions = {
      title: rows.length === 1 ? 'Export song' : `Export ${rows.length} songs`,
      defaultPath: path.join(app.getPath('downloads'), `${name}${PACKAGE_EXT}`),
      filters: [{ name: 'Karaokay song package', extensions: ['karaokay'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, saveOpts) : await dialog.showSaveDialog(saveOpts)
    if (r.canceled || !r.filePath) return null
    const dest = r.filePath.toLowerCase().endsWith(PACKAGE_EXT) ? r.filePath : `${r.filePath}${PACKAGE_EXT}`
    let last = 0
    return exportSongs(s.songs, s.library, rows.map((x) => x.id), dest, { includeVideo, generator: `Karaokay ${app.getVersion()}` }, (done, total) => {
      const now = Date.now()
      if (done < total && now - last < 100) return
      last = now
      send('package:progress', { done, total })
    })
  })

  // ---- analysis
  handle('analysis:pending', () => s.songs.pendingAnalysis())
  handle('analysis:saveKey', async (id, key) => {
    const row = s.songs.getRow(id)
    if (!row || row.key_source === 'manual') return
    s.songs.updateFields(id, {
      key_tonic: ((Math.round(key.tonic) % 12) + 12) % 12,
      key_mode: key.mode === 'minor' ? 'minor' : 'major',
      key_source: 'detected',
      key_confidence: key.confidence,
      analysis_status: 'done'
    })
    await s.library.writeJsonFor(id)
    send('library:changed', { added: [], updated: [id], removed: [] })
  })
  handle('analysis:markFailed', (id, reason) => {
    console.warn('key analysis failed', id, reason)
    s.songs.setAnalysis(id, 'failed')
    send('library:changed', { added: [], updated: [id], removed: [] })
  })
  handle('analysis:reset', (id) => {
    s.songs.updateFields(id, { key_tonic: null, key_mode: null, key_source: null, key_confidence: null, analysis_status: 'pending' })
    void s.library.writeJsonFor(id)
    send('library:changed', { added: [], updated: [id], removed: [] })
  })

  // ---- queue
  handle('queue:get', () => s.queue.list())
  handle('queue:add', (ids, where) => s.queue.add(ids, where))
  handle('queue:replace', (ids) => s.queue.replace(ids))
  handle('queue:move', (id, to) => s.queue.move(id, to))
  handle('queue:remove', (id) => s.queue.remove(id))
  handle('queue:clear', () => s.queue.clear())
  handle('queue:shift', () => s.queue.shift())
  handle('queue:setTranspose', (id, t) => s.queue.setTranspose(id, t === null ? null : clampTranspose(t)))

  // ---- playlists
  handle('playlists:list', () => s.playlists.list())
  handle('playlists:get', (id) => s.playlists.get(id))
  handle('playlists:create', (name, ids) => s.playlists.create(name, ids))
  handle('playlists:rename', (id, name) => s.playlists.rename(id, name))
  handle('playlists:delete', (id) => s.playlists.delete(id))
  handle('playlists:addSongs', (id, ids) => s.playlists.addSongs(id, ids))
  handle('playlists:removeAt', (id, pos) => s.playlists.removeAt(id, pos))
  handle('playlists:move', (id, from, to) => s.playlists.move(id, from, to))

  // ---- history
  handle('history:list', (limit) => s.history.list(Math.min(limit, 1000)))
  handle('history:record', (id, t) => s.history.record(id, t))

  // ---- lyrics alignment
  handle('lyrics:modelStatus', () => s.aligner.status())
  handle('lyrics:pickAudio', () => s.aligner.pickAudio())
  handle('lyrics:align', (text, pcm, offsetSec) => {
    if (typeof text !== 'string' || !(pcm instanceof Float32Array)) throw new Error('bad request')
    return s.aligner.align(text.slice(0, 50000), pcm, Number(offsetSec) || 0, (p) => send('lyrics:progress', p))
  })
  handle('lyrics:pending', () => s.songs.pendingLyrics())
  handle('lyrics:readDraft', async (id) => {
    const row = s.songs.getRow(id)
    if (!row?.lyrics_draft) return null
    return fs.readFile(path.join(s.library.dirOf(row.folder), row.lyrics_draft), 'utf8').catch(() => null)
  })
  handle('lyrics:markChecked', async (id) => {
    s.songs.setLyricsReview(id, false)
    await s.library.writeJsonFor(id)
    send('library:changed', { added: [], updated: [id], removed: [] })
    const song = s.songs.get(id)
    if (!song) throw new Error('song not found')
    return song
  })
  handle('lyrics:save', async (id, srt, opts) => {
    const row = s.songs.getRow(id)
    if (!row) throw new Error('song not found')
    if (typeof srt !== 'string' || !srt.includes('-->')) throw new Error('nothing to save')
    const dir = s.library.dirOf(row.folder)
    if (row.lyrics) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await fs.copyFile(path.join(dir, row.lyrics), path.join(dir, `lyrics.${stamp}.srt.bak`)).catch(() => undefined)
      if (row.lyrics !== 'lyrics.srt') await fs.unlink(path.join(dir, row.lyrics)).catch(() => undefined)
    }
    await fs.writeFile(path.join(dir, 'lyrics.srt'), srt, 'utf8')
    // the pasted text now lives in the srt
    if (row.lyrics_draft) await fs.unlink(path.join(dir, row.lyrics_draft)).catch(() => undefined)
    s.songs.setLyricsReview(id, opts?.review === true)
    await s.library.writeJsonFor(id)
    await s.library.scanFolder(row.folder, true)
    send('library:changed', { added: [], updated: [id], removed: [] })
    const song = s.songs.get(id)
    if (!song) throw new Error('song not found')
    return song
  })

  // ---- settings
  handle('settings:get', () => s.settings.getAll())
  handle('settings:set', (key, value) => {
    if (key === 'libraryRoot') throw new Error('use settings:chooseLibraryFolder')
    const current = s.settings.getAll()
    if (typeof value !== typeof current[key]) throw new Error(`bad value for ${key}`)
    if (key === 'focusTheme' && !isThemeId(value)) throw new Error('unknown theme')
    if (key === 'importMode' && value !== 'copy' && value !== 'move') throw new Error('bad import mode')
    return s.settings.set(key, value as never)
  })
  handle('settings:chooseLibraryFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = { title: 'Choose library folder', properties: ['openDirectory', 'createDirectory'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    await s.setLibraryRoot(r.filePaths[0])
    return s.settings.getAll()
  })
}
