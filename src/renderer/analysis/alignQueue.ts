// Background lyric timing for songs imported with pasted lyrics (lyrics.txt).
import { mediaUrl } from '../../shared/ipc'
import { api } from '../api'
import { engine } from '../audio/engine'
import { useUi } from '../stores/ui'
import { decodeMono } from './keyQueue'

let lock: Promise<unknown> = Promise.resolve()

/** Run alignment work one job at a time (the queue and the lyrics dialog share the model). */
export function withAlignLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn)
  lock = run.catch(() => undefined)
  return run
}

/** songs that failed this session; not retried until restart */
const failed = new Set<string>()
let running = false
let again = false

function cleanError(e: unknown): string {
  return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
}

/** Time every song whose pasted lyrics are waiting, one at a time. */
export async function runAlignQueue(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  const ui = useUi.getState()
  let toastId: number | null = null
  let off: (() => void) | null = null
  let timed = 0
  try {
    do {
      again = false
      const ids = (await api.invoke('lyrics:pending')).filter((id) => !failed.has(id))
      for (let n = 0; n < ids.length; n++) {
        const id = ids[n]
        while (engine.state === 'loading') await new Promise((r) => setTimeout(r, 500))
        const song = await api.invoke('library:get', id)
        if (!song || song.missing || song.hasLyrics || !song.hasVocals) continue
        const label = `Timing lyrics for “${song.title}”${ids.length > 1 ? ` (${n + 1} of ${ids.length})` : ''}…`
        if (toastId === null) {
          toastId = ui.toast(label, 'info', 0)
          off = api.on('lyrics:progress', (p) => {
            if (toastId === null) return
            // download is the only long stage worth showing as a bar on its own
            const pct = p.stage === 'download' ? p.progress : p.stage === 'analyse' ? p.progress * 0.9 : 0.95
            useUi.getState().updateToast(toastId, { progress: pct, ...(p.stage === 'download' ? { text: 'Downloading the lyric timing model (one time only)…' } : {}) })
          })
        } else useUi.getState().updateToast(toastId, { text: label, progress: 0 })
        try {
          await withAlignLock(async () => {
            const text = await api.invoke('lyrics:readDraft', id)
            if (!text?.trim()) throw new Error('the pasted lyrics are empty')
            const pcm = await decodeMono(mediaUrl(song.id, 'vocals', encodeURIComponent(song.folder)))
            const result = await api.invoke('lyrics:align', text, pcm, song.vocalOffsetMs / 1000)
            await api.invoke('lyrics:save', id, result.srt, { review: true })
          })
          timed++
        } catch (e) {
          failed.add(id)
          useUi.getState().toast(`Couldn't time the lyrics for “${song.title}”: ${cleanError(e)}. Open “Lyrics from text…” to try again.`, 'error', 8000)
        }
      }
    } while (again)
  } finally {
    off?.()
    if (toastId !== null) useUi.getState().dismissToast(toastId)
    if (timed) useUi.getState().toast(`Lyrics timed for ${timed} song${timed === 1 ? '' : 's'}. Give the ones marked CHECK a listen.`, 'ok', 6000)
    running = false
  }
}
