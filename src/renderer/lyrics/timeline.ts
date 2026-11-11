import type { Cue } from '../../shared/types'

export const TITLE_LEAD = 4 // title card fades out this long before the first line
export const COUNTDOWN = 4 // dots light over the last N seconds before a line after a gap
export const SHORT_GAP = 4
export const LONG_BREAK = 15
export const BREAK_REVEAL = 6 // upcoming line appears this long before its cue in a long break

export interface LyricFrame {
  current: Cue | null
  currentIndex: number
  /** 0..1 sweep across the current line */
  progress: number
  /** the current line has finished and is fading */
  currentDone: boolean
  next: Cue | null
  showTitle: boolean
  /** number of countdown dots lit (0 = hidden, 1..4) */
  countdown: number
  /** progress through a long instrumental break, or null */
  breakProgress: number | null
  ended: boolean
}

const EMPTY: LyricFrame = {
  current: null,
  currentIndex: -1,
  progress: 0,
  currentDone: false,
  next: null,
  showTitle: true,
  countdown: 0,
  breakProgress: null,
  ended: false
}

function dots(remaining: number): number {
  if (remaining > COUNTDOWN || remaining <= 0) return 0
  return Math.max(1, Math.min(COUNTDOWN, COUNTDOWN + 1 - Math.ceil(remaining)))
}

/** Index of the last cue starting at or before t (binary search), or -1. */
export function cueIndexAt(cues: Cue[], t: number): number {
  let lo = 0
  let hi = cues.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export function lyricFrame(cues: Cue[], t: number): LyricFrame {
  if (cues.length === 0) return EMPTY
  const idx = cueIndexAt(cues, t)
  if (idx === -1) {
    const first = cues[0]
    const remaining = first.start - t
    return {
      ...EMPTY,
      showTitle: remaining > TITLE_LEAD,
      next: remaining <= Math.max(TITLE_LEAD, BREAK_REVEAL) ? first : null,
      countdown: first.start >= SHORT_GAP ? dots(remaining) : 0
    }
  }
  const c = cues[idx]
  const nxt = cues[idx + 1] ?? null
  if (t < c.end) {
    const span = Math.max(0.001, c.end - c.start)
    return { ...EMPTY, showTitle: false, current: c, currentIndex: idx, progress: Math.min(1, (t - c.start) / span), next: nxt }
  }
  const since = t - c.end
  if (!nxt) {
    return { ...EMPTY, showTitle: false, current: since < 2 ? c : null, currentIndex: since < 2 ? idx : -1, progress: 1, currentDone: true, ended: since >= 2 }
  }
  const gap = nxt.start - c.end
  const remaining = nxt.start - t
  if (gap < SHORT_GAP) {
    return { ...EMPTY, showTitle: false, current: c, currentIndex: idx, progress: 1, currentDone: true, next: nxt }
  }
  if (gap < LONG_BREAK) {
    const keep = since < 1.5
    return {
      ...EMPTY,
      showTitle: false,
      current: keep ? c : null,
      currentIndex: keep ? idx : -1,
      progress: 1,
      currentDone: true,
      next: nxt,
      countdown: dots(remaining)
    }
  }
  return {
    ...EMPTY,
    showTitle: false,
    current: null,
    next: remaining <= BREAK_REVEAL ? nxt : null,
    countdown: dots(remaining),
    breakProgress: Math.min(1, since / gap)
  }
}
