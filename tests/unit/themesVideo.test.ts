import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ net: {}, protocol: {} }))
import { parseRange } from '../../src/main/protocol'
import { groupFiles } from '../../src/main/library/grouping'
import { isThemeId, THEMES } from '../../src/shared/themes'

describe('parseRange', () => {
  it('handles open, closed, suffix and bad ranges', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('invalid')
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})

describe('video grouping', () => {
  it('attaches the only video in a song folder', () => {
    expect(groupFiles(['/s/inst.flac', '/s/clip.mp4'])[0].video).toBe('/s/clip.mp4')
  })
  it('matches videos by name in a shared folder', () => {
    const g = groupFiles(['/m/One.mp3', '/m/Two.mp3', '/m/Two.mp4'])
    expect(g.find((x) => x.base === 'Two')?.video).toBe('/m/Two.mp4')
    expect(g.find((x) => x.base === 'One')?.video).toBeNull()
  })
})

describe('themes', () => {
  it('validates ids', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['party', 'midnight', 'neon', 'warm', 'clean'])
    expect(isThemeId('neon')).toBe(true)
    expect(isThemeId('disco')).toBe(false)
    expect(isThemeId(null)).toBe(false)
  })
})
