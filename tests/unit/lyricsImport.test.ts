import { describe, expect, it } from 'vitest'
import { parseLrc } from '../../src/shared/srt'
import { groupFiles } from '../../src/main/library/grouping'
import { tidyLyrics } from '../../src/main/library/importer'

describe('parseLrc', () => {
  it('parses stamps, ends each line at the next, skips metadata', () => {
    const cues = parseLrc('[ar:Someone]\n[ti:Song]\n[00:01.50]First line\n[00:04.00]Second <00:04.50>line\n[00:07.25]\n[00:09]Last')
    expect(cues).toEqual([
      { start: 1.5, end: 4, text: 'First line' },
      { start: 4, end: 7.25, text: 'Second line' },
      { start: 9, end: 13, text: 'Last' }
    ])
  })
  it('expands repeated stamps and applies offset', () => {
    const cues = parseLrc('[offset:+500]\n[00:10.00][00:20.00]Chorus\n[00:12.00]Verse')
    expect(cues.map((c) => [c.start, c.text])).toEqual([
      [9.5, 'Chorus'],
      [11.5, 'Verse'],
      [19.5, 'Chorus']
    ])
  })
  it('returns nothing for plain text', () => {
    expect(parseLrc('just words\nmore words')).toEqual([])
  })
})

describe('lyric files in grouping', () => {
  it('prefers srt, then lrc', () => {
    const g = groupFiles(['/a/Song.flac', '/a/Song.lrc', '/a/Song.srt'])
    expect(g[0].lyrics).toBe('/a/Song.srt')
    expect(groupFiles(['/a/Song.flac', '/a/Song.lrc'])[0].lyrics).toBe('/a/Song.lrc')
  })
  it('takes a .txt only when its name matches', () => {
    expect(groupFiles(['/a/Song.flac', '/a/readme.txt'])[0].lyrics).toBeNull()
    expect(groupFiles(['/a/Song.flac', '/a/lyrics.txt'])[0].lyrics).toBe('/a/lyrics.txt')
    expect(groupFiles(['/a/Song (Instrumental).flac', '/a/Song.txt'])[0].lyrics).toBe('/a/Song.txt')
  })
  it('matches by name when several songs share a folder', () => {
    const g = groupFiles(['/m/One.mp3', '/m/Two.mp3', '/m/Two.txt', '/m/notes.txt'])
    expect(g.find((x) => x.base === 'Two')?.lyrics).toBe('/m/Two.txt')
    expect(g.find((x) => x.base === 'One')?.lyrics).toBeNull()
  })
})

describe('tidyLyrics', () => {
  it('normalises line endings and blank runs', () => {
    expect(tidyLyrics('﻿a  \r\nb\r\n\r\n\r\n\r\nc\n')).toBe('a\nb\n\nc')
  })
})
