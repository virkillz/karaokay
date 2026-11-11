import { describe, expect, it } from 'vitest'
import { parseSrt, srtToText } from '../../src/shared/srt'
import { formatTranspose, keyName, keyShort, parseTonic } from '../../src/shared/keys'

describe('parseSrt', () => {
  it('parses a normal file with CRLF and BOM', () => {
    const s = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\nHello <i>world</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000\r\nLine one\r\nLine two\r\n'
    const cues = parseSrt(s)
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hello world' },
      { start: 4, end: 6, text: 'Line one\nLine two' }
    ])
  })

  it('tolerates missing indices, dot separators and ASS tags', () => {
    const s = '00:00:10.5 --> 00:00:12.25\n{\\an8}Up top\n\n\n\n00:01:00,000 --> 00:01:02,000\nNext'
    const cues = parseSrt(s)
    expect(cues[0]).toEqual({ start: 10.5, end: 12.25, text: 'Up top' })
    expect(cues[1].start).toBe(60)
  })

  it('handles cues without blank separators', () => {
    const s = '1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:02,000 --> 00:00:03,000\nB\n'
    expect(parseSrt(s).map((c) => c.text)).toEqual(['A', 'B'])
  })

  it('sorts and clamps overlaps', () => {
    const s = '2\n00:00:05,000 --> 00:00:07,000\nB\n\n1\n00:00:01,000 --> 00:00:06,000\nA\n'
    const cues = parseSrt(s)
    expect(cues.map((c) => c.text)).toEqual(['A', 'B'])
    expect(cues[0].end).toBe(5)
  })

  it('skips garbage and empty cues', () => {
    expect(parseSrt('not an srt\n\n1\n00:00:01,000 --> 00:00:02,000\n<b></b>\n')).toEqual([])
  })

  it('makes plain text', () => {
    expect(srtToText('1\n00:00:01,000 --> 00:00:02,000\nA\nB\n')).toBe('A B')
  })
})

describe('keys', () => {
  it('names keys with fixed spelling', () => {
    expect(keyName({ tonic: 8, mode: 'major' })).toBe('A♭ major')
    expect(keyName({ tonic: 8, mode: 'major' }, 2)).toBe('B♭ major')
    expect(keyName({ tonic: 6, mode: 'minor' })).toBe('F♯ minor')
    expect(keyName({ tonic: 1, mode: 'minor' })).toBe('C♯ minor')
    expect(keyShort({ tonic: 6, mode: 'minor' }, -2)).toBe('Em')
    expect(keyShort({ tonic: 0, mode: 'major' }, -1)).toBe('B')
  })
  it('parses tonics', () => {
    expect(parseTonic('Ab')).toBe(8)
    expect(parseTonic('C#')).toBe(1)
    expect(parseTonic('B')).toBe(11)
    expect(parseTonic('Cb')).toBe(11)
    expect(parseTonic('H')).toBeNull()
  })
  it('formats transpose', () => {
    expect(formatTranspose(2)).toBe('+2')
    expect(formatTranspose(-3)).toBe('−3')
    expect(formatTranspose(0)).toBe('0')
  })
})
