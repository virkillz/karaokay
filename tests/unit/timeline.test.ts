import { describe, expect, it } from 'vitest'
import { lyricFrame, cueIndexAt } from '../../src/renderer/lyrics/timeline'
import type { Cue } from '../../src/shared/types'

const cues: Cue[] = [
  { start: 8, end: 11, text: 'one' },
  { start: 12, end: 15, text: 'two' }, // 1 s gap
  { start: 22, end: 25, text: 'three' }, // 7 s gap
  { start: 50, end: 53, text: 'four' } // 25 s break
]

describe('lyricFrame', () => {
  it('shows the title card early, then countdown before the first line', () => {
    const f0 = lyricFrame(cues, 1)
    expect(f0.showTitle).toBe(true)
    expect(f0.countdown).toBe(0)
    const f1 = lyricFrame(cues, 4.5) // 3.5 s left
    expect(f1.showTitle).toBe(false)
    expect(f1.next?.text).toBe('one')
    expect(f1.countdown).toBe(1)
    expect(lyricFrame(cues, 7.5).countdown).toBe(4)
  })

  it('sweeps the current line', () => {
    const f = lyricFrame(cues, 9.5)
    expect(f.current?.text).toBe('one')
    expect(f.progress).toBeCloseTo(0.5)
    expect(f.next?.text).toBe('two')
    expect(f.countdown).toBe(0)
  })

  it('keeps the finished line during a short gap', () => {
    const f = lyricFrame(cues, 11.5)
    expect(f.current?.text).toBe('one')
    expect(f.currentDone).toBe(true)
    expect(f.next?.text).toBe('two')
  })

  it('counts down in a medium gap', () => {
    const f = lyricFrame(cues, 19.2) // 2.8 s left
    expect(f.current).toBeNull()
    expect(f.next?.text).toBe('three')
    expect(f.countdown).toBe(2)
  })

  it('shows break progress in a long break and reveals the next line late', () => {
    const f = lyricFrame(cues, 30)
    expect(f.breakProgress).toBeCloseTo(0.2)
    expect(f.next).toBeNull()
    const g = lyricFrame(cues, 45)
    expect(g.next?.text).toBe('four')
    expect(g.countdown).toBe(0)
    expect(lyricFrame(cues, 47).countdown).toBe(2)
  })

  it('ends after the last line', () => {
    expect(lyricFrame(cues, 54).current?.text).toBe('four')
    expect(lyricFrame(cues, 56).ended).toBe(true)
  })

  it('handles no lyrics', () => {
    expect(lyricFrame([], 3).showTitle).toBe(true)
  })

  it('binary searches', () => {
    expect(cueIndexAt(cues, 0)).toBe(-1)
    expect(cueIndexAt(cues, 12)).toBe(1)
    expect(cueIndexAt(cues, 100)).toBe(3)
  })
})
