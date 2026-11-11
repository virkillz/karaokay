import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { mediaUrl } from '../../shared/ipc'
import type { Song } from '../../shared/types'
import { engine } from '../audio/engine'

const TILE_COLORS = ['#FFD23F', '#19C3B0', '#FF7EB6', '#B9A6FF', '#7FD1FF', '#FFA36C', '#B8F0E9', '#FFE3EF']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Song cover, or a generated colour tile with the title's first letter. */
export function Cover({ song, className = '', style }: { song: Pick<Song, 'id' | 'title' | 'hasCover' | 'folder'> | null; className?: string; style?: CSSProperties }) {
  const [broken, setBroken] = useState(false)
  if (song && song.hasCover && !broken) {
    return (
      <img
        className={`cover ${className}`}
        style={style}
        src={mediaUrl(song.id, 'cover', encodeURIComponent(song.folder))}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    )
  }
  const letter = (song?.title.match(/[\p{L}\p{N}]/u)?.[0] ?? '♪').toUpperCase()
  return (
    <span className={`cover ${className}`} style={{ background: TILE_COLORS[hash(song?.id ?? 'x') % TILE_COLORS.length], ...style }} aria-hidden>
      {letter}
    </span>
  )
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${min % 60} min`
}

/** Re-render at `hz` with the engine position (lyrics use their own rAF loop instead). */
export function usePosition(hz = 4): number {
  const [pos, setPos] = useState(engine.position)
  useEffect(() => {
    const id = window.setInterval(() => setPos(engine.position), 1000 / hz)
    return () => clearInterval(id)
  }, [hz])
  return pos
}

interface SliderProps {
  value: number
  max?: number
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  label: string
  color?: string
  className?: string
  step?: number
  valueText?: string
}

/** Pointer + keyboard slider in the candy style. */
export function Slider({ value, max = 1, onChange, onCommit, label, color, className = '', step, valueText }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [local, setLocal] = useState<number | null>(null)
  const shown = local ?? value
  const pct = max > 0 ? Math.max(0, Math.min(1, shown / max)) * 100 : 0
  const at = (clientX: number): number => {
    const r = ref.current!.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * max
  }
  const st = step ?? max / 20
  return (
    <div
      ref={ref}
      className={`slider ${className}`}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown * 100) / 100}
      aria-valuetext={valueText}
      onPointerDown={(e) => {
        dragging.current = true
        ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
        const v = at(e.clientX)
        setLocal(v)
        onChange(v)
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return
        const v = at(e.clientX)
        setLocal(v)
        onChange(v)
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return
        dragging.current = false
        const v = at(e.clientX)
        setLocal(null)
        onCommit?.(v)
      }}
      onKeyDown={(e) => {
        let v: number | null = null
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = Math.min(max, value + st)
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = Math.max(0, value - st)
        if (v !== null) {
          e.preventDefault()
          e.stopPropagation()
          onChange(v)
          onCommit?.(v)
        }
      }}
    >
      <div className="track">
        <div className="fill" style={{ width: `${pct}%`, background: color }} />
        <div className="thumb" style={{ left: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  // map folded positions back to original by folding char by char
  const chars = [...text]
  const folded = chars.map((c) => fold(c))
  const out: ReactNode[] = []
  let i = 0
  let buf = ''
  while (i < chars.length) {
    const atWordStart = i === 0 || !/[\p{L}\p{N}]/u.test(chars[i - 1])
    let matched = 0
    if (atWordStart) {
      for (const t of terms) {
        let j = i
        let acc = ''
        while (j < chars.length && acc.length < t.length) acc += folded[j++]
        if (acc.startsWith(t) && j - i > matched) matched = j - i
      }
    }
    if (matched > 0) {
      if (buf) out.push(buf)
      buf = ''
      out.push(<mark key={i}>{chars.slice(i, i + matched).join('')}</mark>)
      i += matched
    } else {
      buf += chars[i++]
    }
  }
  if (buf) out.push(buf)
  return <>{out}</>
}

export function searchTerms(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}
