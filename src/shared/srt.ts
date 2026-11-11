import type { Cue } from './types'

const TIME = /(\d{1,2}):(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?/
const ARROW = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`)

function toSeconds(h: string, m: string, s: string, ms: string | undefined): number {
  const frac = ms ? Number(ms.padEnd(3, '0')) / 1000 : 0
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + frac
}

/** Remove HTML-ish tags and ASS override blocks. */
export function stripMarkup(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * Tolerant SRT parser. Accepts CRLF, BOM, missing index lines, '.' millisecond
 * separators and extra blank lines. Returns cues sorted by start with overlaps clamped.
 */
export function parseSrt(input: string): Cue[] {
  const text = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const cues: Cue[] = []
  let i = 0
  while (i < lines.length) {
    const m = ARROW.exec(lines[i])
    if (!m) {
      i++
      continue
    }
    const start = toSeconds(m[1], m[2], m[3], m[4])
    const end = toSeconds(m[5], m[6], m[7], m[8])
    i++
    const body: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      // a following timing line without a blank separator starts a new cue
      if (ARROW.test(lines[i])) break
      body.push(lines[i])
      i++
    }
    // drop a trailing bare index number that belongs to the next cue
    if (body.length > 0 && /^\d+$/.test(body[body.length - 1].trim()) && i < lines.length && ARROW.test(lines[i] ?? '')) {
      body.pop()
    }
    const cleaned = body.map(stripMarkup).filter((l) => l.length > 0)
    if (cleaned.length === 0) continue
    cues.push({ start, end: Math.max(end, start), text: cleaned.join('\n') })
  }
  cues.sort((a, b) => a.start - b.start)
  for (let k = 0; k < cues.length - 1; k++) {
    if (cues[k].end > cues[k + 1].start) cues[k].end = Math.max(cues[k].start, cues[k + 1].start)
  }
  return cues
}

/** 00:01:02,345 */
export function formatSrtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0')
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`
}

/** Serialise cues as SRT. Empty-text cues are skipped. */
export function cuesToSrt(cues: Cue[]): string {
  return cues
    .filter((c) => c.text.trim() !== '')
    .map((c, i) => `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(Math.max(c.start, c.end))}\n${c.text.trim()}\n`)
    .join('\n')
}

const LRC_TIME = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

/**
 * Parse LRC ("[01:02.34]text"). Handles several stamps per line, [offset:±ms], word-level <mm:ss.xx>
 * stamps (removed) and empty stamped lines (they end the previous line). Each line ends where the next starts.
 */
export function parseLrc(input: string): Cue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const offMatch = /^\s*\[offset:\s*([+-]?\d+)\s*\]/im.exec(text)
  // positive LRC offset means lyrics appear sooner
  const offset = offMatch ? -Number(offMatch[1]) / 1000 : 0
  const stamps: { t: number; text: string }[] = []
  for (const line of text.split('\n')) {
    const times: number[] = []
    LRC_TIME.lastIndex = 0
    let m: RegExpExecArray | null
    let rest = line
    while ((m = LRC_TIME.exec(line))) {
      times.push(Number(m[1]) * 60 + Number(m[2].replace(':', '.')))
      rest = line.slice(LRC_TIME.lastIndex)
    }
    if (times.length === 0) continue
    const words = stripMarkup(rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, ''))
    for (const t of times) stamps.push({ t: Math.max(0, t + offset), text: words })
  }
  stamps.sort((a, b) => a.t - b.t)
  const cues: Cue[] = []
  stamps.forEach((s, i) => {
    if (!s.text) return
    const next = stamps[i + 1]
    cues.push({ start: s.t, end: next ? next.t : s.t + 4, text: s.text })
  })
  return cues
}

/** Plain lyric text for search indexing. */
export function srtToText(input: string): string {
  return parseSrt(input)
    .map((c) => c.text.replace(/\n/g, ' '))
    .join('\n')
}
