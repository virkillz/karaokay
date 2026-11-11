import { describe, expect, it } from 'vitest'
import { analyseName, groupFiles, sanitiseFolderName, splitArtistTitle } from '../../src/main/library/grouping'

describe('analyseName', () => {
  it.each([
    ['Nora Vale - After Midnight (Instrumental)', 'instrumental', 'Nora Vale - After Midnight'],
    ['Nora Vale - After Midnight (Vocals)', 'vocals', 'Nora Vale - After Midnight'],
    ['neon_midnight_inst', 'instrumental', 'neon midnight'],
    ['neon_midnight_vox', 'vocals', 'neon midnight'],
    ['Song Title - Karaoke Version', 'instrumental', 'Song Title'],
    ['Song Title [Off Vocal]', 'instrumental', 'Song Title'],
    ['Song Title - Backing Track', 'instrumental', 'Song Title'],
    ['Song Title (a cappella)', 'vocals', 'Song Title'],
    ['instrumental', 'instrumental', ''],
    ['vocals', 'vocals', ''],
    ['Midnight on Maple Street', null, 'Midnight on Maple Street'],
    ['Lead Me Home', null, 'Lead Me Home'],
    ['Instrumental Love Song', null, 'Instrumental Love Song']
  ])('%s', (input, role, clean) => {
    const r = analyseName(input)
    expect(r.role).toBe(role)
    expect(r.clean).toBe(clean)
  })

  it('normalises for matching', () => {
    expect(analyseName('Nora Vale - After Midnight (Vocals)').norm).toBe(analyseName('Nora Vale - After Midnight.').norm)
  })
})

describe('groupFiles', () => {
  it('pairs files by name in a mixed folder', () => {
    const groups = groupFiles([
      '/d/Nora Vale - After Midnight (Instrumental).flac',
      '/d/Nora Vale - After Midnight (Vocals).flac',
      '/d/Nora Vale - After Midnight.srt',
      '/d/neon_midnight_inst.mp3',
      '/d/neon_midnight_vox.mp3',
      '/d/Midnight on Maple Street.wav',
      '/d/Midnight on Maple Street.srt',
      '/d/notes.txt'
    ])
    expect(groups).toHaveLength(3)
    const nora = groups.find((g) => g.base.startsWith('Nora'))!
    expect(nora.instrumental).toMatch(/Instrumental\)\.flac$/)
    expect(nora.vocals).toMatch(/Vocals\)\.flac$/)
    expect(nora.lyrics).toMatch(/\.srt$/)
    const neon = groups.find((g) => g.base === 'neon midnight')!
    expect(neon.instrumental).toMatch(/_inst\.mp3$/)
    expect(neon.vocals).toMatch(/_vox\.mp3$/)
    expect(neon.lyrics).toBeNull()
    const maple = groups.find((g) => g.base === 'Midnight on Maple Street')!
    expect(maple.instrumental).toMatch(/\.wav$/)
    expect(maple.vocals).toBeNull()
    expect(maple.lyrics).toMatch(/\.srt$/)
  })

  it('treats a library-style folder as one song', () => {
    const groups = groupFiles([
      '/lib/Kilo Static - Neon Midnight/instrumental.mp3',
      '/lib/Kilo Static - Neon Midnight/vocals.mp3',
      '/lib/Kilo Static - Neon Midnight/lyrics.srt',
      '/lib/Kilo Static - Neon Midnight/cover.jpg'
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].base).toBe('Kilo Static - Neon Midnight')
    expect(groups[0].instrumental).toMatch(/instrumental\.mp3$/)
    expect(groups[0].vocals).toMatch(/vocals\.mp3$/)
    expect(groups[0].lyrics).toMatch(/lyrics\.srt$/)
    expect(groups[0].cover).toMatch(/cover\.jpg$/)
  })

  it('two unmarked audio files with different names are two songs', () => {
    const groups = groupFiles(['/x/Song A.mp3', '/x/Song B.mp3'])
    expect(groups).toHaveLength(2)
  })

  it('prefers flac over mp3 for the same role', () => {
    const groups = groupFiles(['/y/Song - x (Instrumental).mp3', '/y/Song - x (Instrumental).flac', '/y/Song - x (Vocals).mp3'])
    expect(groups).toHaveLength(1)
    expect(groups[0].instrumental).toMatch(/\.flac$/)
  })
})

describe('helpers', () => {
  it('splits artist and title', () => {
    expect(splitArtistTitle('Nora Vale - After Midnight, Before You')).toEqual({ artist: 'Nora Vale', title: 'After Midnight, Before You' })
    expect(splitArtistTitle('Just a Title')).toEqual({ artist: null, title: 'Just a Title' })
  })
  it('sanitises folder names', () => {
    expect(sanitiseFolderName('AC/DC: Back?')).toBe('AC DC Back')
  })
})
