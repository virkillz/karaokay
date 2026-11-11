import { describe, expect, it } from 'vitest'
import {
  fmtTime, fromCues, indexAt, insertAfter, mergeNext, nudge, parseTime, remove, setEnd, setStart, shiftAll, split, stampEnd, stampStart, toCues,
  type EditCue
} from '../../src/renderer/lyrics/editCues'
import { cuesToSrt, parseSrt } from '../../src/shared/srt'

const mk = (...spans: [number, number, string?][]): EditCue[] => fromCues(spans.map(([start, end, text], i) => ({ start, end, text: text ?? `L${i}` })))
const times = (c: EditCue[]): [number, number][] => c.map((x) => [x.start, x.end])

describe('time text', () => {
  it('formats and parses', () => {
    expect(fmtTime(62.345)).toBe('1:02.35')
    expect(fmtTime(0)).toBe('0:00.00')
    expect(parseTime('1:02.5')).toBe(62.5)
    expect(parseTime('62.5')).toBe(62.5)
    expect(parseTime('0:01:02,345')).toBe(62.345)
    expect(parseTime('1:02')).toBe(62)
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('setStart / setEnd', () => {
  it('moves a touching previous end along with the start', () => {
    const c = setStart(mk([0, 2], [2, 4]), 1, 2.5)
    expect(times(c)).toEqual([[0, 2.5], [2.5, 4]])
  })
  it('leaves a gap alone when moving later', () => {
    const c = setStart(mk([0, 1], [2, 4]), 1, 2.5)
    expect(times(c)).toEqual([[0, 1], [2.5, 4]])
  })
  it('trims the previous line when moving into it', () => {
    const c = setStart(mk([0, 2], [3, 4]), 1, 1.5)
    expect(times(c)).toEqual([[0, 1.5], [1.5, 4]])
  })
  it('never moves before the previous start', () => {
    const c = setStart(mk([1, 2], [3, 4]), 1, 0)
    expect(c[1].start).toBeCloseTo(1.1)
    expect(c[0].end).toBeCloseTo(1.1)
  })
  it('clears the check flag once touched', () => {
    const c = fromCues([{ start: 0, end: 1, text: 'a' }], 0, ['check'])
    expect(setStart(c, 0, 0.2)[0].flag).toBeNull()
  })
  it('end stops at an untouching next line, drags a touching one', () => {
    expect(times(setEnd(mk([0, 1], [2, 3]), 0, 5))).toEqual([[0, 2], [2, 3]])
    expect(times(setEnd(mk([0, 2], [2, 4]), 0, 2.5))).toEqual([[0, 2.5], [2.5, 4]])
  })
  it('nudge shifts the whole line', () => {
    expect(times(nudge(mk([0, 1], [2, 3], [5, 6]), 1, 0.5))).toEqual([[0, 1], [2.5, 3.5], [5, 6]])
  })
})

describe('tap sync', () => {
  it('a tap closes the previous tapped line and pushes later lines that are too early', () => {
    let c = mk([0, 1], [1, 2], [2, 3])
    c = stampStart(c, 0, 5, false)
    expect(c[0].start).toBe(5)
    expect(c[1].start).toBeGreaterThanOrEqual(5.1)
    c = stampStart(c, 1, 7, true)
    expect(c[0].end).toBe(7)
    expect(c[1].start).toBe(7)
    expect(c[2].start).toBeGreaterThanOrEqual(7.1)
    expect(toCues(c).every((x, i, a) => i === 0 || a[i - 1].end <= x.start)).toBe(true)
  })
  it('a held line sets its own end', () => {
    let c = mk([0, 1], [1.5, 2])
    c = stampEnd(c, 0, 1.8)
    expect(times(c)).toEqual([[0, 1.8], [1.8, 2.3]])
  })
})

describe('structure', () => {
  it('splits at the middle space with time by text length', () => {
    const c = split(mk([0, 4, 'aaa bbb']), 0)
    expect(c.map((x) => x.text)).toEqual(['aaa', 'bbb'])
    expect(times(c)).toEqual([[0, 2], [2, 4]])
  })
  it('splits at a caret', () => {
    expect(split(mk([0, 4, 'one two three']), 0, 3).map((x) => x.text)).toEqual(['one', 'two three'])
  })
  it('merges with the next line', () => {
    const c = mergeNext(mk([0, 1, 'a'], [1.5, 3, 'b'], [4, 5]), 0)
    expect(c.map((x) => x.text)).toEqual(['a b', 'L2'])
    expect(times(c)[0]).toEqual([0, 3])
  })
  it('inserts into a gap, or pushes when there is none', () => {
    expect(times(insertAfter(mk([0, 1], [5, 6]), 0))).toEqual([[0, 1], [1, 3], [5, 6]])
    const tight = insertAfter(mk([0, 1], [1, 2]), 0)
    expect(tight).toHaveLength(3)
    expect(tight[2].start).toBeGreaterThanOrEqual(tight[1].start + 0.1)
    expect(insertAfter([], -1)).toHaveLength(1)
  })
  it('removes and shifts all', () => {
    expect(remove(mk([0, 1], [2, 3]), 0)).toHaveLength(1)
    expect(times(shiftAll(mk([1, 2], [3, 4]), -5))).toEqual([[0, 1], [2, 3]])
  })
  it('indexAt finds the playing line', () => {
    const c = mk([0, 1], [2, 3])
    expect(indexAt(c, 0.5)).toBe(0)
    expect(indexAt(c, 1.5)).toBe(-1)
    expect(indexAt(c, 2)).toBe(1)
  })
})

describe('round trip', () => {
  it('applies and removes the lyric offset and drops empty lines', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\nHi\n\n2\n00:00:03,000 --> 00:00:04,500\nThere\n'
    const edit = fromCues(parseSrt(src), 0.5)
    expect(edit[0].start).toBe(1.5)
    const withBlank = insertAfter(edit, 1)
    expect(cuesToSrt(toCues(withBlank, 0.5))).toBe(src)
  })
})
