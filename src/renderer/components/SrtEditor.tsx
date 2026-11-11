import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Song } from '../../shared/types'
import { cuesToSrt, parseSrt } from '../../shared/srt'
import { api } from '../api'
import { engine } from '../audio/engine'
import {
  fmtTime, fromCues, indexAt, insertAfter, mergeNext, parseTime, remove, setEnd, setStart, setText, shiftAll, split, stampEnd, stampStart, toCues,
  type EditCue
} from '../lyrics/editCues'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { reloadSavedLyrics } from './LyricsDialog'
import { IconMinus, IconPause, IconPlay, IconPlus, IconX } from './icons'

const HOLD = 0.4 // a tap held at least this long sets the line's end on release
const HISTORY = 200

function typingIn(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  if (t.tagName === 'INPUT') return (t as HTMLInputElement).type !== 'checkbox'
  return t.tagName === 'TEXTAREA' || t.isContentEditable
}

/** A time field that shows m:ss.cc and commits on Enter or blur. */
function TimeInput({ value, onCommit, label }: { value: number; onCommit: (t: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const done = (): void => {
    if (draft === null) return
    const t = parseTime(draft)
    setDraft(null)
    if (t !== null && Math.abs(t - value) > 0.0005) onCommit(t)
  }
  return (
    <input
      className={`se-time ${draft !== null && parseTime(draft) === null ? 'bad' : ''}`}
      aria-label={label}
      value={draft ?? fmtTime(value)}
      onFocus={(e) => {
        setDraft(fmtTime(value))
        e.currentTarget.select()
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      spellCheck={false}
    />
  )
}

export function SrtEditor() {
  const ed = useUi((s) => s.editor)
  if (!ed) return null
  return <Editor key={ed.songId} songId={ed.songId} seed={ed.seed} />
}

function Editor({ songId, seed }: { songId: string; seed?: NonNullable<ReturnType<typeof useUi.getState>['editor']>['seed'] }) {
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const isCurrent = usePlayer((s) => s.current?.id === songId)
  const [song, setSong] = useState<Song | null>(null)
  const [offset, setOffset] = useState(0)
  const [cues, setCues] = useState<EditCue[]>([])
  const [sel, setSel] = useState(0)
  const [nowIdx, setNowIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [raw, setRaw] = useState<string | null>(null)
  const [rawError, setRawError] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [saving, setSaving] = useState(false)
  const [tapping, setTapping] = useState(false)

  const past = useRef<EditCue[][]>([])
  const future = useRef<EditCue[][]>([])
  const lastKey = useRef<string | null>(null)
  const cuesRef = useRef(cues)
  cuesRef.current = cues
  const selRef = useRef(sel)
  selRef.current = sel
  const previewed = useRef(false)
  const tap = useRef<{ index: number; start: number } | null>(null)
  const lastTap = useRef<{ index: number; held: boolean } | null>(null)
  const clockRef = useRef<HTMLSpanElement>(null)
  const caret = useRef<{ id: number; pos: number } | null>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const focusText = useRef<number | null>(null)

  // ---- load
  useEffect(() => {
    let alive = true
    void (async () => {
      const s = await api.invoke('library:get', songId)
      if (!alive || !s) return
      const p = usePlayer.getState()
      const offMs = p.current?.id === s.id ? p.current.lyricsOffsetMs : s.lyricsOffsetMs
      const off = offMs / 1000
      let initial: EditCue[]
      if (seed) {
        initial = fromCues(seed.cues, off, seed.flags)
        setDirty(true)
      } else {
        const text = s.hasLyrics ? await api.invoke('library:readLyrics', s.id) : null
        initial = fromCues(text ? parseSrt(text) : [], off)
      }
      if (!alive) return
      setSong(s)
      setOffset(off)
      setCues(initial)
    })()
    return () => {
      alive = false
    }
  }, [songId, seed])

  // ---- edits with undo
  const commit = useCallback((next: EditCue[], mergeKey: string | null = null) => {
    if (next === cuesRef.current) return
    if (!(mergeKey && mergeKey === lastKey.current)) {
      past.current.push(cuesRef.current)
      if (past.current.length > HISTORY) past.current.shift()
    }
    lastKey.current = mergeKey
    future.current = []
    cuesRef.current = next
    setCues(next)
    setDirty(true)
  }, [])
  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(cuesRef.current)
    lastKey.current = null
    setCues(prev)
    setDirty(true)
  }, [])
  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(cuesRef.current)
    lastKey.current = null
    setCues(next)
  }, [])

  // ---- live preview in the player (player cues are file times: subtract the offset)
  useEffect(() => {
    if (!song || !isCurrent) return
    usePlayer.setState({ cues: toCues(cues, offset) })
    previewed.current = true
  }, [cues, isCurrent, offset, song])

  // ---- follow playback
  useEffect(() => {
    let raf = 0
    let lastPos = -1
    const tick = (): void => {
      const cur = usePlayer.getState().current?.id === songId
      const t = cur ? engine.position : 0
      const on = cur && engine.isPlaying
      setPlaying(on)
      if (Math.abs(t - lastPos) >= 0.01 && clockRef.current) {
        lastPos = t
        clockRef.current.textContent = fmtTime(t)
      }
      setNowIdx(cur ? indexAt(cuesRef.current, t) : -1)
      if (loop && on) {
        const c = cuesRef.current[selRef.current]
        if (c && (t > c.end + 0.4 || t < c.start - 1.5)) engine.seek(Math.max(0, c.start - 0.8))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [songId, loop])

  // keep the selected row in view
  useLayoutEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
    if (focusText.current === sel) {
      el?.querySelector('textarea')?.focus()
      focusText.current = null
    }
  }, [sel, cues.length])

  const playFrom = useCallback(
    async (at: number): Promise<void> => {
      const p = usePlayer.getState()
      if (p.current?.id !== songId) await p.playNow(songId)
      engine.seek(Math.max(0, at))
      if (!engine.isPlaying) void engine.play()
    },
    [songId]
  )
  const togglePlay = useCallback(() => {
    if (usePlayer.getState().current?.id !== songId) void playFrom(cuesRef.current[selRef.current]?.start - 1 || 0)
    else engine.toggle()
  }, [playFrom, songId])

  // ---- tap sync
  const tapDown = useCallback(() => {
    if (tap.current || usePlayer.getState().current?.id !== songId || !engine.isPlaying) {
      if (!engine.isPlaying) toast('Play the song first, then hold T as each line is sung.', 'info', 3000)
      return
    }
    const i = selRef.current
    const list = cuesRef.current
    if (i >= list.length) return
    const t = engine.position
    const prev = lastTap.current
    commit(stampStart(list, i, t, !!prev && prev.index === i - 1 && !prev.held))
    tap.current = { index: i, start: t }
    setTapping(true)
  }, [commit, songId, toast])
  const tapUp = useCallback(() => {
    const cur = tap.current
    if (!cur) return
    tap.current = null
    setTapping(false)
    const t = engine.position
    const held = t - cur.start >= HOLD
    if (held) commit(stampEnd(cuesRef.current, cur.index, t))
    lastTap.current = { index: cur.index, held }
    setSel(Math.min(cur.index + 1, cuesRef.current.length - 1))
  }, [commit])

  // ---- close / save
  const close = useCallback(
    (force = false) => {
      if (saving) return
      if (dirty && !force) {
        setConfirmClose(true)
        return
      }
      if (previewed.current && song) void reloadSavedLyrics(song)
      set({ editor: null })
    },
    [dirty, saving, set, song]
  )

  const currentCues = (): EditCue[] | null => {
    if (raw === null) return cues
    const parsed = parseSrt(raw)
    if (parsed.length === 0 && raw.trim() !== '') {
      setRawError(true)
      return null
    }
    return fromCues(parsed)
  }

  const markChecked = async (): Promise<void> => {
    if (!song) return
    const updated = await api.invoke('lyrics:markChecked', song.id)
    usePlayer.getState().onSongUpdated(updated)
    set({ editor: null })
    toast(`“${song.title}” lyrics marked as checked`, 'ok', 2500)
  }

  const save = async (): Promise<void> => {
    if (!song) return
    const list = currentCues()
    if (!list) return
    const out = toCues(list)
    if (out.length === 0) {
      toast('Add at least one line with words before saving.', 'error', 4000)
      return
    }
    setSaving(true)
    try {
      let updated = await api.invoke('lyrics:save', song.id, cuesToSrt(out))
      // timings now include the offset, so the offset goes back to zero
      if (updated.lyricsOffsetMs !== 0 || offset !== 0) updated = await api.invoke('library:update', song.id, { lyricsOffsetMs: 0 })
      const p = usePlayer.getState()
      p.onSongUpdated(updated)
      if (p.current?.id === song.id) usePlayer.setState({ current: { ...usePlayer.getState().current!, lyricsOffsetMs: 0 }, cues: out })
      set({ editor: null })
      toast(`Lyrics saved for “${song.title}”`, 'ok', 3000)
    } catch (e) {
      setSaving(false)
      toast(`Couldn't save lyrics: ${e instanceof Error ? e.message : e}`, 'error', 6000)
    }
  }

  const toggleRaw = (): void => {
    if (raw === null) {
      setRaw(cuesToSrt(toCues(cues)))
      setRawError(false)
      return
    }
    const list = currentCues()
    if (!list) return
    if (cuesToSrt(toCues(list)) !== cuesToSrt(toCues(cues))) commit(list)
    setRaw(null)
    setSel((s) => Math.min(s, Math.max(0, list.length - 1)))
  }

  // ---- keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (useUi.getState().editor?.songId !== songId) return
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (typingIn(e)) (e.target as HTMLElement).blur()
        else if (confirmClose) setConfirmClose(false)
        else close()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void save()
        return
      }
      if (typingIn(e) || raw !== null) return
      e.stopPropagation()
      const list = cuesRef.current
      const i = selRef.current
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod || e.altKey) return
      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowUp':
          e.preventDefault()
          setSel(Math.max(0, i - 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setSel(Math.min(list.length - 1, i + 1))
          break
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault()
          if (list[i]) commit(setStart(list, i, list[i].start + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.5 : 0.1)), `nudge:${list[i].id}`)
          break
        case 'Enter':
          if ((e.target as HTMLElement).tagName === 'BUTTON') return
          e.preventDefault()
          if (list[i]) void playFrom(list[i].start - 1)
          break
        case 't':
        case 'T':
          e.preventDefault()
          if (!e.repeat) tapDown()
          break
      }
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 't' || e.key === 'T') tapUp()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
    }
  })

  if (!song) return null
  const unsure = cues.filter((c) => c.flag).length
  const lines = cues.filter((c) => c.text.trim()).length
  const at = (i: number) => (fn: (list: EditCue[], i: number) => EditCue[]) => commit(fn(cuesRef.current, i))

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog srt-editor" role="dialog" aria-modal aria-labelledby="se-title">
        <header>
          <h2 id="se-title">Edit lyrics</h2>
          <p>
            {song.title} · {song.artist}
          </p>
        </header>

        <div className="se-bar">
          <button className="icon-btn sm pink" aria-label={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {playing ? <IconPause size={15} /> : <IconPlay size={15} />}
          </button>
          <span className="se-clock num" ref={clockRef}>
            {fmtTime(0)}
          </span>
          <button
            className={`btn sm se-tap ${tapping ? 'on' : ''}`}
            disabled={raw !== null}
            onPointerDown={(e) => {
              e.preventDefault()
              tapDown()
            }}
            onPointerUp={tapUp}
            onPointerLeave={tapUp}
            title="Hold while the selected line is sung, or tap at its start (keyboard: T)"
          >
            Hold to sync <kbd>T</kbd>
          </button>
          <label className="se-check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop line
          </label>
          <span className="se-group" aria-label="Shift all lines">
            <span className="label">All lines</span>
            <button className="icon-btn xs" aria-label="All lines earlier by 0.1 s" disabled={raw !== null} onClick={() => commit(shiftAll(cuesRef.current, -0.1), 'shiftAll')}>
              <IconMinus size={12} />
            </button>
            <button className="icon-btn xs" aria-label="All lines later by 0.1 s" disabled={raw !== null} onClick={() => commit(shiftAll(cuesRef.current, 0.1), 'shiftAll')}>
              <IconPlus size={12} />
            </button>
          </span>
          <span className="se-spacer" />
          <button className="btn sm ghost" onClick={undo} disabled={raw !== null || past.current.length === 0}>
            Undo
          </button>
          <button className="btn sm ghost" onClick={redo} disabled={raw !== null || future.current.length === 0}>
            Redo
          </button>
          <button className={`btn sm ${raw !== null ? 'sun' : ''}`} onClick={toggleRaw}>
            {raw !== null ? 'Back to lines' : 'SRT text'}
          </button>
        </div>

        {raw !== null ? (
          <div className="body">
            <label className="ly-paste">
              <span className="label">{rawError ? 'Couldn’t find any SRT cues in this text.' : 'Raw SRT: edit freely, then go back to lines'}</span>
              <textarea className="se-raw" value={raw} onChange={(e) => (setRaw(e.target.value), setRawError(false), setDirty(true))} spellCheck={false} />
            </label>
          </div>
        ) : (
          <div className="body se-body">
            <p className="se-help">
              <b>Hold T</b> while a line is sung (or tap at its start). <b>←/→</b> moves the selected start by 0.1 s (Shift: 0.5 s), <b>↑/↓</b> selects,{' '}
              <b>Enter</b> plays from it, <b>Space</b> plays/pauses.
            </p>
            {cues.length === 0 && (
              <div className="se-empty">
                <span>No lines yet.</span>
                <button
                  className="btn sm sun"
                  onClick={() => {
                    focusText.current = 0
                    commit(insertAfter([], -1))
                    setSel(0)
                  }}
                >
                  Add the first line
                </button>
              </div>
            )}
            <ol className="se-lines" ref={listRef}>
              {cues.map((c, i) => (
                <li
                  key={c.id}
                  className={`${i === sel ? 'sel' : ''} ${i === nowIdx ? 'now' : ''} ${c.flag ? 'low' : ''}`}
                  onMouseDown={() => setSel(i)}
                >
                  <button className="icon-btn xs" aria-label={`Play from line ${i + 1}`} onClick={() => void playFrom(c.start - 1)}>
                    <IconPlay size={10} />
                  </button>
                  <span className="se-nudge">
                    <button className="se-step" aria-label="Start earlier" onClick={() => at(i)((l, k) => setStart(l, k, l[k].start - 0.1))}>
                      −
                    </button>
                    <TimeInput label={`Line ${i + 1} start`} value={c.start} onCommit={(t) => at(i)((l, k) => setStart(l, k, t))} />
                    <button className="se-step" aria-label="Start later" onClick={() => at(i)((l, k) => setStart(l, k, l[k].start + 0.1))}>
                      +
                    </button>
                  </span>
                  <span className="se-arrow">→</span>
                  <TimeInput label={`Line ${i + 1} end`} value={c.end} onCommit={(t) => at(i)((l, k) => setEnd(l, k, t))} />
                  <textarea
                    className="se-text"
                    rows={Math.max(1, c.text.split('\n').length)}
                    value={c.text}
                    placeholder="Lyrics for this line"
                    onFocus={() => setSel(i)}
                    onChange={(e) => commit(setText(cuesRef.current, i, e.target.value), `text:${c.id}`)}
                    onSelect={(e) => (caret.current = { id: c.id, pos: e.currentTarget.selectionStart })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (i + 1 < cues.length) {
                          focusText.current = i + 1
                          setSel(i + 1)
                        } else e.currentTarget.blur()
                      }
                    }}
                    spellCheck={false}
                  />
                  {c.flag && <span className="pill sun">{c.flag === 'guessed' ? 'guessed' : 'check'}</span>}
                  <span className="se-acts">
                    <button className="btn xs ghost" title="Split this line at the cursor (or in the middle)" onClick={() => at(i)((l, k) => split(l, k, caret.current?.id === c.id ? caret.current.pos : undefined))}>
                      Split
                    </button>
                    <button className="btn xs ghost" title="Join with the next line" disabled={i === cues.length - 1} onClick={() => at(i)(mergeNext)}>
                      Join ↓
                    </button>
                    <button
                      className="btn xs ghost"
                      title="Add a line after this one"
                      onClick={() => {
                        focusText.current = i + 1
                        at(i)(insertAfter)
                        setSel(i + 1)
                      }}
                    >
                      + Line
                    </button>
                    <button
                      className="icon-btn xs"
                      aria-label={`Delete line ${i + 1}`}
                      onClick={() => {
                        at(i)(remove)
                        setSel(Math.max(0, Math.min(i, cues.length - 2)))
                      }}
                    >
                      <IconX size={10} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <footer>
          {confirmClose ? (
            <>
              <span className="note">
                <b>Discard your changes?</b>
              </span>
              <button className="btn" onClick={() => setConfirmClose(false)} autoFocus>
                Keep editing
              </button>
              <button className="btn primary" onClick={() => close(true)}>
                Discard
              </button>
            </>
          ) : (
            <>
              <span className="note">
                {lines} line{lines === 1 ? '' : 's'}
                {unsure ? ` · ${unsure} to check` : ''}
                {offset !== 0 ? ` · the ${offset > 0 ? '+' : ''}${offset.toFixed(2)} s lyric offset is built into these times` : ''}
                {song.lyricsReview ? ' · timed automatically: play it through and fix anything that’s off' : song.hasLyrics ? ' · the old file is kept as a backup' : ''}
              </span>
              <button className="btn" onClick={() => close()}>
                Cancel
              </button>
              {song.lyricsReview && !dirty && !seed ? (
                <button className="btn primary" onClick={() => void markChecked()}>
                  Looks good
                </button>
              ) : (
                <button className="btn primary" disabled={saving || (!dirty && !seed)} onClick={() => void save()}>
                  Save lyrics
                </button>
              )}
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
