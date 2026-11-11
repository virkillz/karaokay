import type { Mode, SongKey } from './types'

const MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
const MINOR = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']

export const TRANSPOSE_MIN = -6
export const TRANSPOSE_MAX = 6

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12
}

export function tonicName(tonic: number, mode: Mode): string {
  return (mode === 'major' ? MAJOR : MINOR)[mod12(tonic)]
}

/** "B♭ major" */
export function keyName(key: Pick<SongKey, 'tonic' | 'mode'>, transpose = 0): string {
  return `${tonicName(key.tonic + transpose, key.mode)} ${key.mode}`
}

/** compact form for chips: "B♭", "F♯m" */
export function keyShort(key: Pick<SongKey, 'tonic' | 'mode'> | null, transpose = 0): string {
  if (!key) return '–'
  return tonicName(key.tonic + transpose, key.mode) + (key.mode === 'minor' ? 'm' : '')
}

export function formatTranspose(n: number): string {
  if (n === 0) return '0'
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`
}

export function clampTranspose(n: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, Math.round(n)))
}

/** Parse essentia-style names ("Ab", "C#", "Bb") or our own spelling into a pitch class. */
export function parseTonic(name: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)$/.exec(name.trim())
  if (!m) return null
  const base: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  let pc = base[m[1].toUpperCase()]
  if (m[2] === '#' || m[2] === '♯') pc += 1
  if (m[2] === 'b' || m[2] === '♭') pc -= 1
  return mod12(pc)
}

export const ALL_TONICS = Array.from({ length: 12 }, (_, i) => i)
