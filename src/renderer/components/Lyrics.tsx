import { useEffect, useRef, useState } from 'react'
import type { Cue, Song } from '../../shared/types'
import { keyName } from '../../shared/keys'
import { engine } from '../audio/engine'
import { lyricFrame, type LyricFrame } from '../lyrics/timeline'
import { useUi } from '../stores/ui'

interface Shape {
  cur: number
  done: boolean
  next: Cue | null
  showTitle: boolean
  countdown: number
  breakPct: number | null
  ended: boolean
}

function shapeOf(f: LyricFrame): Shape {
  return {
    cur: f.currentIndex,
    done: f.currentDone,
    next: f.next,
    showTitle: f.showTitle,
    countdown: f.countdown,
    breakPct: f.breakProgress === null ? null : Math.round(f.breakProgress * 50) * 2,
    ended: f.ended
  }
}

function same(a: Shape, b: Shape): boolean {
  return a.cur === b.cur && a.done === b.done && a.next === b.next && a.showTitle === b.showTitle && a.countdown === b.countdown && a.breakPct === b.breakPct && a.ended === b.ended
}

/**
 * Drives lyric display from the audio position. Structural changes (which line, countdown) re-render;
 * the sweep is written straight to a CSS variable every frame.
 */
export function useLyricFrame(cues: Cue[], offsetMs: number): { shape: Shape; sweepRef: React.RefObject<HTMLParagraphElement | null>; cues: Cue[] } {
  const sweepRef = useRef<HTMLParagraphElement>(null)
  const [shape, setShape] = useState<Shape>(() => shapeOf(lyricFrame(cues, engine.position - offsetMs / 1000)))
  const shapeRef = useRef(shape)
  useEffect(() => {
    let raf = 0
    const tick = (): void => {
      const f = lyricFrame(cues, engine.position - offsetMs / 1000)
      const s = shapeOf(f)
      if (!same(s, shapeRef.current)) {
        shapeRef.current = s
        setShape(s)
      }
      if (sweepRef.current) sweepRef.current.style.setProperty('--p', `${(f.progress * 100).toFixed(2)}%`)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [cues, offsetMs])
  return { shape, sweepRef, cues }
}

export function Countdown({ n }: { n: number }) {
  return (
    <div className="countdown" aria-hidden style={{ visibility: n > 0 ? 'visible' : 'hidden' }}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={i <= n ? 'on' : ''} />
      ))}
    </div>
  )
}

/** Big two-line lyrics for the Sing panel. */
export function LyricLines({ song, cues, transpose }: { song: Song; cues: Cue[]; transpose: number }) {
  const { shape, sweepRef } = useLyricFrame(cues, song.lyricsOffsetMs)
  const cur = shape.cur >= 0 ? cues[shape.cur] : null
  const titleCard = (
    <div className="title-card">
      <div className="t">{song.title}</div>
      <div className="a">{song.artist}</div>
      <div className="k">
        {song.key && <span className="pill sun">{keyName(song.key, transpose)}</span>}
        {!song.hasLyrics && <span className="pill white" style={{ marginLeft: 8 }}>No lyrics for this song</span>}
      </div>
      {!song.hasLyrics && (
        <div className="add-lyrics">
          <button className="btn sun shadow" onClick={() => useUi.getState().set({ lyricsSongId: song.id })}>
            Add lyrics from text
          </button>
        </div>
      )}
    </div>
  )
  if (cues.length === 0 || (shape.showTitle && !cur)) {
    return (
      <div className="lyrics" aria-live="off">
        {titleCard}
      </div>
    )
  }
  return (
    <div className="lyrics">
      {shape.breakPct !== null && !shape.next && (
        <div className="break-bar">
          <span aria-hidden>♪</span>
          <span className="track">
            <i style={{ width: `${shape.breakPct}%` }} />
          </span>
          <span>instrumental break</span>
        </div>
      )}
      <Countdown n={shape.countdown} />
      {cur ? (
        <p key={shape.cur} ref={sweepRef} className={`lyric-current ${shape.done ? 'done' : ''}`}>
          <span className="sweep">{cur.text}</span>
        </p>
      ) : null}
      {shape.next && (
        <p key={`n${shape.next.start}`} className={`lyric-next ${cur ? '' : 'alone'}`}>
          {shape.next.text}
        </p>
      )}
      {!cur && !shape.next && shape.breakPct === null && shape.ended && <div className="title-card"><div className="a">♪ {song.title}</div></div>}
    </div>
  )
}
