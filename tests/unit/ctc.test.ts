import { describe, expect, it } from 'vitest'
import { alignLines, ctcAlign, linesToSrt, prepareLyrics, wordToChars } from '../../src/main/align/ctc'
import { parseSrt } from '../../src/shared/srt'

const VOCAB: Record<string, number> = { "'": 28 }
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => (VOCAB[c] = 4 + i))
const C = 31

/** Build log-prob emissions where `script` maps frame ranges to a character (rest is blank). */
function emissions(frames: number, script: [number, number, string][]): Float32Array {
  const e = new Float32Array(frames * C).fill(Math.log(0.01 / (C - 1)))
  for (let t = 0; t < frames; t++) e[t * C] = Math.log(0.99)
  for (const [a, b, ch] of script) {
    for (let t = a; t <= b; t++) {
      for (let c = 0; c < C; c++) e[t * C + c] = Math.log(0.01 / (C - 1))
      e[t * C + VOCAB[ch]] = Math.log(0.99)
    }
  }
  return e
}

describe('wordToChars', () => {
  it('romanises and strips', () => {
    expect(wordToChars('Don’t')).toBe("don't")
    expect(wordToChars('café,')).toBe('cafe')
    expect(wordToChars('Привет')).toBe('privet')
    expect(wordToChars('123')).toBe('')
  })
})

describe('prepareLyrics', () => {
  it('drops section tags and blank lines', () => {
    const lines = prepareLyrics('[Verse 1]\nHello there\n\n(Chorus)\nGo  go\n', VOCAB)
    expect(lines.map((l) => l.text)).toEqual(['Hello there', 'Go go'])
    expect(lines[0].words[0].tokens).toEqual([...'hello'].map((c) => VOCAB[c]))
  })
})

describe('ctcAlign', () => {
  it('finds token positions, including repeated letters', () => {
    // "aab" with the repeated a separated by a blank frame
    const e = emissions(20, [[3, 4, 'a'], [6, 7, 'a'], [12, 13, 'b']])
    const spans = ctcAlign(e, 20, C, [VOCAB.a, VOCAB.a, VOCAB.b])!
    expect(spans.map((s) => s.start)).toEqual([3, 6, 12])
    expect(spans[2].end).toBe(13)
    expect(spans[0].score).toBeGreaterThan(0.9)
  })
  it('returns null when audio is too short', () => {
    expect(ctcAlign(emissions(2, []), 2, C, [VOCAB.a, VOCAB.a])).toBeNull()
  })
})

describe('alignLines', () => {
  it('times lines and interpolates unalignable ones', () => {
    const lines = prepareLyrics('hi\n123\nyo', VOCAB)
    const e = emissions(300, [[50, 52, 'h'], [55, 57, 'i'], [250, 252, 'y'], [255, 258, 'o']])
    const r = alignLines(lines, e, 300, C, 0.02, 6)
    expect(r.lines[0].start).toBeCloseTo(1.0, 2)
    expect(r.lines[0].end).toBeCloseTo(1.16, 2)
    expect(r.lines[2].start).toBeCloseTo(5.0, 2)
    expect(r.lines[1].interpolated).toBe(true)
    expect(r.lines[1].start).toBeGreaterThan(r.lines[0].end)
    expect(r.lines[1].end).toBeLessThanOrEqual(r.lines[2].start)
    const cues = parseSrt(linesToSrt(r.lines))
    expect(cues.map((c) => c.text)).toEqual(['hi', '123', 'yo'])
    expect(cues[0].start).toBeCloseTo(1.0, 2)
  })
})
