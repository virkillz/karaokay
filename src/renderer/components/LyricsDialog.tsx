import { useEffect, useRef, useState } from 'react'
import type { AlignResult, AlignProgress, Song } from '../../shared/types'
import { mediaUrl, pickedUrl } from '../../shared/ipc'
import { parseSrt } from '../../shared/srt'
import { api } from '../api'
import { decodeMono } from '../analysis/keyQueue'
import { withAlignLock } from '../analysis/alignQueue'
import { engine } from '../audio/engine'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { formatTime } from './common'
import { IconPlay } from './icons'
import mascotCheer from '../assets/mascot_cheer.webp'

const LOW_SCORE = 0.35
const REPEAT_MARK = /(^|\s)[x×]\s?\d+\b|\b\d+\s?[x×]($|\s)|\brepeat\b/im

type Phase = { kind: 'edit' } | { kind: 'working'; progress: AlignProgress | null } | { kind: 'review'; result: AlignResult } | { kind: 'error'; message: string }

function stageText(p: AlignProgress | null): string {
  if (!p) return 'Getting ready…'
  if (p.stage === 'download') return `Downloading the alignment model (one time only)… ${Math.round(p.progress * 100)}%`
  if (p.stage === 'analyse') return `Listening to the vocals… ${Math.round(p.progress * 100)}%`
  return 'Fitting your lyrics to the music…'
}

function fmtTime(sec: number): string {
  return `${formatTime(sec)}.${Math.floor((sec % 1) * 10)}`
}

/** Restore the song's saved lyrics in the player after a preview. */
export async function reloadSavedLyrics(song: Song): Promise<void> {
  const p = usePlayer.getState()
  if (p.current?.id !== song.id) return
  const text = song.hasLyrics ? await api.invoke('library:readLyrics', song.id) : null
  usePlayer.setState({ cues: text ? parseSrt(text) : [] })
}

export function LyricsDialog() {
  const id = useUi((s) => s.lyricsSongId)
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const [song, setSong] = useState<Song | null>(null)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'edit' })
  const [picked, setPicked] = useState<{ token: string; name: string } | null>(null)
  const [modelReady, setModelReady] = useState<{ ready: boolean; downloadMB: number } | null>(null)
  const previewed = useRef(false)

  useEffect(() => {
    if (!id) return
    setPhase({ kind: 'edit' })
    setPicked(null)
    previewed.current = false
    void api.invoke('lyrics:modelStatus').then(setModelReady)
    void api.invoke('library:get', id).then(async (s) => {
      setSong(s)
      if (s?.hasLyrics) {
        const srt = await api.invoke('library:readLyrics', s.id)
        setText(srt ? parseSrt(srt).map((c) => c.text.replace(/\n/g, ' ')).join('\n') : '')
      } else if (s?.lyricsDraft) setText((await api.invoke('lyrics:readDraft', s.id)) ?? '')
      else setText('')
    })
  }, [id])

  useEffect(() => {
    if (!id) return
    return api.on('lyrics:progress', (p) => setPhase((cur) => (cur.kind === 'working' ? { kind: 'working', progress: p } : cur)))
  }, [id])

  const close = (): void => {
    if (phase.kind === 'working') return
    if (previewed.current && song) void reloadSavedLyrics(song)
    set({ lyricsSongId: null })
  }
  useEffect(() => {
    if (!id) return
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  })

  if (!id || !song) return null
  const canAlign = song.hasVocals || !!picked
  const lineCount = text.split('\n').filter((l) => l.trim() && !/^\s*[[{(<][^\])}>]*[\])}>]\s*$/.test(l)).length

  const run = async (): Promise<void> => {
    setPhase({ kind: 'working', progress: null })
    try {
      const url = picked ? pickedUrl(picked.token) : mediaUrl(song.id, 'vocals', encodeURIComponent(song.folder))
      const offset = picked ? 0 : song.vocalOffsetMs / 1000
      const result = await withAlignLock(async () => api.invoke('lyrics:align', text, await decodeMono(url), offset))
      setModelReady({ ready: true, downloadMB: 0 })
      setPhase({ kind: 'review', result })
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
      setPhase({ kind: 'error', message: msg })
    }
  }

  const preview = async (result: AlignResult, at: number): Promise<void> => {
    const p = usePlayer.getState()
    if (p.current?.id !== song.id) await p.playNow(song.id)
    usePlayer.setState({ cues: parseSrt(result.srt) })
    previewed.current = true
    engine.seek(Math.max(0, at - 1.5))
    if (!engine.isPlaying) void engine.play()
  }

  const save = async (result: AlignResult): Promise<void> => {
    try {
      const updated = await api.invoke('lyrics:save', song.id, result.srt)
      usePlayer.getState().onSongUpdated(updated)
      if (usePlayer.getState().current?.id === song.id) usePlayer.setState({ cues: parseSrt(result.srt) })
      set({ lyricsSongId: null })
      toast(`Lyrics saved for “${song.title}”`, 'ok', 3000)
    } catch (e) {
      toast(`Couldn't save lyrics: ${e instanceof Error ? e.message : e}`, 'error', 6000)
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog lyrics-dialog" role="dialog" aria-modal aria-labelledby="ly-title">
        <img className="mascot" src={mascotCheer} alt="" />
        <header>
          <h2 id="ly-title">Lyrics from text</h2>
          <p>
            {song.title} · {song.artist}
          </p>
        </header>

        {phase.kind === 'edit' && (
          <>
            <div className="body">
              <label className="ly-paste">
                <span className="label">Paste the lyrics, one karaoke line per line</span>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'First line of the song\nSecond line…\n\n[Chorus]\nLines in brackets on their own are ignored'}
                  spellCheck={false}
                  autoFocus
                />
              </label>
              <ul className="ly-tips">
                <li>Write repeated choruses out in full, in the order they're sung.</li>
                <li>Latin-alphabet lyrics in any language work best; other scripts are transliterated.</li>
                {REPEAT_MARK.test(text) && <li className="warn">Looks like there's a repeat marker (like “x2”). Write those lines out instead, or the timing will drift.</li>}
              </ul>
              <div className="ly-source">
                {song.hasVocals ? (
                  <span>Timing comes from this song's vocal track.</span>
                ) : (
                  <>
                    <span>{picked ? `Timing from: ${picked.name}` : 'This song has no vocal track. Choose the original recording (with singing) to time the lyrics against.'}</span>
                    <button className="btn sm" onClick={async () => setPicked((await api.invoke('lyrics:pickAudio')) ?? picked)}>
                      {picked ? 'Change…' : 'Choose recording…'}
                    </button>
                  </>
                )}
              </div>
            </div>
            <footer>
              <span className="note">
                {modelReady && !modelReady.ready ? `First time only: downloads the ${modelReady.downloadMB} MB alignment model from Hugging Face. Everything else stays on this Mac.` : `${lineCount} line${lineCount === 1 ? '' : 's'}`}
              </span>
              <button className="btn" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" disabled={!canAlign || lineCount === 0} onClick={() => void run()}>
                Time my lyrics
              </button>
            </footer>
          </>
        )}

        {phase.kind === 'working' && (
          <div className="body ly-working">
            <div className="label">{stageText(phase.progress)}</div>
            <div className="ly-bar">
              <i style={{ width: `${Math.round((phase.progress?.progress ?? 0) * 100)}%` }} />
            </div>
            <p>A four-minute song takes about 15 seconds.</p>
          </div>
        )}

        {phase.kind === 'error' && (
          <>
            <div className="body">
              <div className="toast error" style={{ maxWidth: 'none' }}>
                {phase.message}
              </div>
            </div>
            <footer>
              <span className="note" />
              <button className="btn" onClick={close}>
                Close
              </button>
              <button className="btn primary" onClick={() => setPhase({ kind: 'edit' })}>
                Back to lyrics
              </button>
            </footer>
          </>
        )}

        {phase.kind === 'review' &&
          (() => {
            const lines = phase.result.lines
            const unsure = lines.filter((l) => l.interpolated || l.score < LOW_SCORE).length
            return (
              <>
                <div className="body">
                  <p className="ly-summary">
                    <b>{lines.length} lines timed.</b>{' '}
                    {unsure ? `${unsure} look${unsure === 1 ? 's' : ''} uncertain — press ▶ to check by ear.` : 'Press ▶ on any line to hear it with the new lyrics.'}
                  </p>
                  <ol className="ly-lines">
                    {lines.map((l, i) => {
                      const low = l.interpolated || l.score < LOW_SCORE
                      return (
                        <li key={i} className={low ? 'low' : ''}>
                          <button className="icon-btn xs" aria-label={`Play from line ${i + 1}`} onClick={() => void preview(phase.result, l.start)}>
                            <IconPlay size={11} />
                          </button>
                          <span className="num t">{fmtTime(l.start)}</span>
                          <span className="x">{l.text}</span>
                          {low && <span className="pill sun">{l.interpolated ? 'guessed' : 'check'}</span>}
                        </li>
                      )
                    })}
                  </ol>
                </div>
                <footer>
                  <span className="note">{song.hasLyrics ? 'The current lyrics file is kept as a backup in the song folder.' : 'Saved as lyrics.srt in the song folder.'}</span>
                  <button className="btn" onClick={() => setPhase({ kind: 'edit' })}>
                    Edit text
                  </button>
                  <button
                    className="btn"
                    onClick={() =>
                      set({
                        lyricsSongId: null,
                        editor: {
                          songId: song.id,
                          seed: { cues: parseSrt(phase.result.srt), flags: lines.map((l) => (l.interpolated ? 'guessed' : l.score < LOW_SCORE ? 'check' : null)) }
                        }
                      })
                    }
                  >
                    Fine-tune timing…
                  </button>
                  <button className="btn primary" onClick={() => void save(phase.result)}>
                    Save lyrics
                  </button>
                </footer>
              </>
            )
          })()}
      </section>
    </div>
  )
}
