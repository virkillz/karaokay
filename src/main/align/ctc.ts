// CTC forced alignment: fit known lyric text to per-frame character probabilities from a CTC model
// (MMS forced aligner). Pure functions, no I/O.
import anyAscii from 'any-ascii'
import type { AlignedLine } from '../../shared/types'
import { cuesToSrt } from '../../shared/srt'

export type { AlignedLine }

export interface LyricWord {
  text: string
  /** token ids (no blanks); empty if nothing in the word is alignable (e.g. digits only) */
  tokens: number[]
}

export interface LyricLine {
  text: string
  words: LyricWord[]
}

export interface WordTiming {
  line: number
  word: number
  start: number
  end: number
  /** mean probability of the word's characters at their aligned frames, 0..1 */
  score: number
}

const SECTION_TAG = /^\s*[[{(<][^\])}>]*[\])}>]\s*$/ // "[Chorus]", "(Verse 2)", "{x2}"

/** Romanise and reduce a word to characters the model knows. */
export function wordToChars(word: string): string {
  return anyAscii(word)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z']/g, '')
    .replace(/^'+|'+$/g, '')
}

/** Split pasted lyrics into karaoke lines and tokenised words. */
export function prepareLyrics(text: string, vocab: Record<string, number>): LyricLine[] {
  const lines: LyricLine[] = []
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line || SECTION_TAG.test(line)) continue
    const words = line
      .split(' ')
      .map((w) => ({ text: w, tokens: [...wordToChars(w)].map((c) => vocab[c]).filter((id): id is number => id !== undefined) }))
    lines.push({ text: line, words })
  }
  return lines
}

/** Log-softmax each frame of raw logits in place. */
export function logSoftmax(logits: Float32Array, frames: number, classes: number): Float32Array {
  for (let t = 0; t < frames; t++) {
    const o = t * classes
    let max = -Infinity
    for (let c = 0; c < classes; c++) if (logits[o + c] > max) max = logits[o + c]
    let sum = 0
    for (let c = 0; c < classes; c++) sum += Math.exp(logits[o + c] - max)
    const lse = max + Math.log(sum)
    for (let c = 0; c < classes; c++) logits[o + c] -= lse
  }
  return logits
}

export interface TokenSpan {
  start: number // first frame
  end: number // last frame (inclusive)
  score: number // mean prob over its frames
}

/**
 * Viterbi CTC alignment. `emissions` is frames × classes log-probs, `tokens` the target sequence
 * (no blanks). Returns one frame span per token, or null if the audio is too short for the text.
 */
export function ctcAlign(emissions: Float32Array, frames: number, classes: number, tokens: number[], blank = 0): TokenSpan[] | null {
  const N = tokens.length
  if (N === 0) return []
  const S = 2 * N + 1
  // minimum frames: one per token plus one blank between identical neighbours
  let need = N
  for (let i = 1; i < N; i++) if (tokens[i] === tokens[i - 1]) need++
  if (frames < need) return null

  const label = (s: number): number => (s % 2 === 0 ? blank : tokens[(s - 1) >> 1])
  const NEG = -1e30
  let prev = new Float32Array(S).fill(NEG)
  let cur = new Float32Array(S)
  const back = new Uint8Array(frames * S) // 0 stay, 1 from s-1, 2 from s-2
  prev[0] = emissions[blank]
  prev[1] = emissions[tokens[0]]
  for (let t = 1; t < frames; t++) {
    const e = t * classes
    // states that cannot reach the end in time are pruned by the backward check below; keep it simple
    const sMin = Math.max(0, S - 2 * (frames - t) - 1)
    const sMax = Math.min(S - 1, 2 * t + 1)
    cur.fill(NEG)
    for (let s = sMin; s <= sMax; s++) {
      let best = prev[s]
      let from = 0
      if (s >= 1 && prev[s - 1] > best) {
        best = prev[s - 1]
        from = 1
      }
      if (s >= 2 && s % 2 === 1 && tokens[(s - 1) >> 1] !== tokens[(s - 3) >> 1] && prev[s - 2] > best) {
        best = prev[s - 2]
        from = 2
      }
      if (best <= NEG) continue
      cur[s] = best + emissions[e + label(s)]
      back[t * S + s] = from
    }
    const tmp = prev
    prev = cur
    cur = tmp
  }
  let s = prev[S - 1] >= prev[S - 2] ? S - 1 : S - 2
  if (prev[s] <= NEG) return null
  const spans: TokenSpan[] = Array.from({ length: N }, () => ({ start: -1, end: -1, score: 0 }))
  const sums = new Float64Array(N)
  const counts = new Uint32Array(N)
  for (let t = frames - 1; t >= 0; t--) {
    if (s % 2 === 1) {
      const k = (s - 1) >> 1
      if (spans[k].end < 0) spans[k].end = t
      spans[k].start = t
      sums[k] += Math.exp(emissions[t * classes + tokens[k]])
      counts[k]++
    }
    s -= back[t * S + s]
  }
  for (let k = 0; k < N; k++) spans[k].score = counts[k] ? sums[k] / counts[k] : 0
  return spans
}

/**
 * Align prepared lyric lines against emissions; returns per-line timings in seconds.
 * `frameSec` is the model's frame duration (0.02 s for wav2vec2/MMS).
 */
export function alignLines(lines: LyricLine[], emissions: Float32Array, frames: number, classes: number, frameSec: number, duration: number): { lines: AlignedLine[]; words: WordTiming[] } {
  const flat: number[] = []
  const owner: { line: number; word: number }[] = []
  lines.forEach((l, li) =>
    l.words.forEach((w, wi) =>
      w.tokens.forEach((tok) => {
        flat.push(tok)
        owner.push({ line: li, word: wi })
      })
    )
  )
  const spans = ctcAlign(emissions, frames, classes, flat)
  if (!spans) throw new Error('The lyrics are too long for this audio.')

  const words: WordTiming[] = []
  const byWord = new Map<string, WordTiming>()
  spans.forEach((sp, k) => {
    const { line, word } = owner[k]
    const key = `${line}:${word}`
    const startSec = sp.start * frameSec
    const endSec = (sp.end + 1) * frameSec
    const w = byWord.get(key)
    if (!w) {
      const nw: WordTiming = { line, word, start: startSec, end: endSec, score: sp.score }
      byWord.set(key, nw)
      words.push(nw)
      ;(nw as WordTiming & { n: number }).n = 1
    } else {
      w.end = endSec
      const n = ++(w as WordTiming & { n: number }).n
      w.score += (sp.score - w.score) / n
    }
  })
  for (const w of words) delete (w as Partial<WordTiming & { n: number }>).n

  const out: AlignedLine[] = lines.map((l, li) => {
    const ws = words.filter((w) => w.line === li)
    if (ws.length === 0) return { text: l.text, start: NaN, end: NaN, score: 0, interpolated: true }
    return {
      text: l.text,
      start: ws[0].start,
      end: ws[ws.length - 1].end,
      score: ws.reduce((a, w) => a + w.score, 0) / ws.length,
      interpolated: false
    }
  })
  // lines with nothing alignable: place them evenly between their neighbours
  for (let i = 0; i < out.length; i++) {
    if (!out[i].interpolated) continue
    let j = i
    while (j < out.length && out[j].interpolated) j++
    const from = i > 0 ? out[i - 1].end : 0
    const to = j < out.length ? out[j].start : duration
    const step = (to - from) / (j - i + 1)
    for (let k = i; k < j; k++) {
      out[k].start = from + step * (k - i + 0.5)
      out[k].end = Math.min(to, out[k].start + Math.max(0.8, step * 0.8))
    }
    i = j
  }
  return { lines: out, words }
}

/** Turn aligned lines into SRT cues with a little tail so lines don't vanish the instant the last word ends. */
export function linesToSrt(lines: AlignedLine[], tail = 0.35): string {
  return cuesToSrt(
    lines.map((l, i) => {
      const next = lines[i + 1]
      const end = Math.max(l.start + 0.3, next ? Math.min(l.end + tail, next.start - 0.05) : l.end + tail)
      return { start: l.start, end, text: l.text }
    })
  )
}
