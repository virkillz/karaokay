// Pure editing operations for the SRT editor. Every function returns a new array; inputs are never mutated.
// Times are "song time" (seconds on the audio clock, lyric offset already applied).
import type { Cue } from '../../shared/types'

export type CueFlag = 'check' | 'guessed' | null

export interface EditCue {
  id: number
  start: number
  end: number
  text: string
  /** aligner was unsure about this line; cleared once the user touches its timing */
  flag: CueFlag
}

/** shortest line we allow */
export const MIN_LEN = 0.1
/** boundaries this close count as "touching" and move together */
const LINK = 0.03

let seq = 0
export function newCue(start: number, end: number, text: string, flag: CueFlag = null): EditCue {
  return { id: ++seq, start, end: Math.max(end, start + MIN_LEN), text, flag }
}

export function fromCues(cues: Cue[], shift = 0, flags: CueFlag[] = []): EditCue[] {
  return cues.map((c, i) => newCue(Math.max(0, c.start + shift), Math.max(0, c.end + shift), c.text, flags[i] ?? null))
}

/** Cues for the player / SRT file: drops empty lines, subtracts the lyric offset, keeps order and no overlaps. */
export function toCues(cues: EditCue[], shift = 0): Cue[] {
  const out = cues
    .filter((c) => c.text.trim() !== '')
    .map((c) => ({ start: Math.max(0, c.start - shift), end: Math.max(0, c.end - shift), text: c.text.trim() }))
    .sort((a, b) => a.start - b.start)
  for (let k = 0; k < out.length; k++) {
    if (out[k].end < out[k].start) out[k].end = out[k].start
    if (k + 1 < out.length && out[k].end > out[k + 1].start) out[k].end = out[k + 1].start
  }
  return out
}

const r3 = (t: number): number => Math.round(t * 1000) / 1000

/** After cue `from` moved, push later cues forward so starts stay ordered, and trim overlapping ends. */
function settle(cues: EditCue[], from: number): EditCue[] {
  for (let k = Math.max(1, from); k < cues.length; k++) {
    const prev = cues[k - 1]
    const c = cues[k]
    let changed = false
    if (c.start < prev.start + MIN_LEN) {
      const d = prev.start + MIN_LEN - c.start
      cues[k] = { ...c, start: r3(c.start + d), end: r3(c.end + d) }
      changed = true
    }
    if (prev.end > cues[k].start) cues[k - 1] = { ...prev, end: cues[k].start }
    if (!changed && k > from + 1) break
  }
  return cues
}

/** Move a line's start. A touching previous end moves with it; the line keeps a minimum length. */
export function setStart(list: EditCue[], i: number, t: number): EditCue[] {
  const cues = list.slice()
  const c = cues[i]
  const prev = cues[i - 1]
  const lo = prev ? prev.start + MIN_LEN : 0
  t = r3(Math.max(lo, t))
  const linked = prev && Math.abs(prev.end - c.start) <= LINK
  cues[i] = { ...c, start: t, end: r3(Math.max(c.end, t + MIN_LEN)), flag: null }
  if (prev && (linked || prev.end > t)) cues[i - 1] = { ...prev, end: t }
  return settle(cues, i + 1)
}

/** Move a line's end. A touching next start moves with it; otherwise the end stops at the next line. */
export function setEnd(list: EditCue[], i: number, t: number): EditCue[] {
  const cues = list.slice()
  const c = cues[i]
  const next = cues[i + 1]
  t = Math.max(c.start + MIN_LEN, t)
  if (next) {
    const linked = Math.abs(next.start - c.end) <= LINK
    if (linked) {
      t = Math.min(t, next.end - MIN_LEN)
      cues[i + 1] = { ...next, start: r3(t) }
    } else t = Math.min(t, next.start)
  }
  cues[i] = { ...c, end: r3(t), flag: null }
  return cues
}

/** Shift a whole line (start and end) by d seconds. */
export function nudge(list: EditCue[], i: number, d: number): EditCue[] {
  const c = list[i]
  const len = c.end - c.start
  const moved = setStart(list, i, c.start + d)
  return setEnd(moved, i, moved[i].start + len)
}

/**
 * Tap-sync: the line starts now. Unlike setStart, this may move the line past later lines; those get pushed.
 * `closePrev` ends the previous line here too (it was tapped, not held, so it has no real end).
 */
export function stampStart(list: EditCue[], i: number, t: number, closePrev: boolean): EditCue[] {
  const cues = list.slice()
  const c = cues[i]
  const prev = cues[i - 1]
  t = r3(Math.max(prev ? prev.start + MIN_LEN : 0, t))
  const next = cues[i + 1]
  let end = t + (c.end - c.start)
  if (next && next.start > t + MIN_LEN) end = Math.min(end, next.start)
  cues[i] = { ...c, start: t, end: r3(Math.max(end, t + MIN_LEN)), flag: null }
  if (prev && (closePrev || prev.end > t)) cues[i - 1] = { ...prev, end: t }
  return settle(cues, i + 1)
}

/** Tap-sync: the line was held until now. Later lines that start earlier get pushed. */
export function stampEnd(list: EditCue[], i: number, t: number): EditCue[] {
  const cues = list.slice()
  const c = cues[i]
  t = r3(Math.max(c.start + MIN_LEN, t))
  cues[i] = { ...c, end: t }
  const next = cues[i + 1]
  if (next && next.start < t) {
    const d = t - next.start
    cues[i + 1] = { ...next, start: t, end: r3(next.end + d) }
    return settle(cues, i + 2)
  }
  return cues
}

export function setText(list: EditCue[], i: number, text: string): EditCue[] {
  const cues = list.slice()
  cues[i] = { ...cues[i], text }
  return cues
}

/** Where to split when no caret position is given: the space nearest the middle. */
export function splitPoint(text: string): number {
  const mid = text.length / 2
  let best = -1
  for (let k = 0; k < text.length; k++) if (/\s/.test(text[k]) && (best < 0 || Math.abs(k - mid) < Math.abs(best - mid))) best = k
  return best < 0 ? Math.floor(mid) : best
}

/** Split a line in two at a character index; time is divided by text length. */
export function split(list: EditCue[], i: number, at?: number): EditCue[] {
  const c = list[i]
  const pos = at === undefined || at <= 0 || at >= c.text.length ? splitPoint(c.text) : at
  const a = c.text.slice(0, pos).trim()
  const b = c.text.slice(pos).trim()
  if (!a || !b) return list
  const mid = r3(c.start + (c.end - c.start) * (a.length / (a.length + b.length)))
  const cues = list.slice()
  cues.splice(i, 1, { ...c, end: Math.max(mid, c.start + MIN_LEN / 2), text: a }, newCue(mid, c.end, b, c.flag))
  return cues
}

/** Join a line with the next one. */
export function mergeNext(list: EditCue[], i: number): EditCue[] {
  const c = list[i]
  const n = list[i + 1]
  if (!n) return list
  const cues = list.slice()
  const text = [c.text.trim(), n.text.trim()].filter(Boolean).join(' ')
  cues.splice(i, 2, { ...c, end: Math.max(c.end, n.end), text, flag: c.flag ?? n.flag })
  return cues
}

/** Add an empty line after i (or at the top when i = -1), filling the gap if there is one. */
export function insertAfter(list: EditCue[], i: number, duration = 2): EditCue[] {
  const prev = list[i]
  const next = list[i + 1]
  const start = prev ? prev.end : 0
  const room = next ? next.start - start : Infinity
  const cues = list.slice()
  const cue = newCue(r3(start), r3(start + Math.min(duration, room >= MIN_LEN * 2 ? room : duration)), '')
  cues.splice(i + 1, 0, cue)
  return room >= MIN_LEN * 2 ? cues : settle(cues, i + 2)
}

export function remove(list: EditCue[], i: number): EditCue[] {
  return list.filter((_, k) => k !== i)
}

/** Shift every line by d seconds (never before 0). */
export function shiftAll(list: EditCue[], d: number): EditCue[] {
  const lo = list.length ? -list[0].start : 0
  d = Math.max(lo, d)
  return list.map((c) => ({ ...c, start: r3(c.start + d), end: r3(c.end + d) }))
}

/** Index of the line playing at t, or -1. */
export function indexAt(list: EditCue[], t: number): number {
  for (let k = list.length - 1; k >= 0; k--) if (list[k].start <= t) return t < list[k].end ? k : -1
  return -1
}

/** m:ss.cc */
export function fmtTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const m = Math.floor(cs / 6000)
  const s = Math.floor(cs / 100) % 60
  return `${m}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Accepts 1:02.5, 62.5, 1:02, 0:01:02,345. Returns null when unreadable. */
export function parseTime(input: string): number | null {
  const s = input.trim().replace(',', '.')
  const m = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d*)?)$/.exec(s)
  if (!m) return null
  const parts = [m[1], m[2], m[3]].filter((p) => p !== undefined).map(Number)
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return Number.isFinite(sec) ? Math.round(sec * 1000) / 1000 : null
}
