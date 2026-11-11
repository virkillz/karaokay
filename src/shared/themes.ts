// Focus-mode themes. The look lives in CSS ([data-theme] on the sing panel); this is the list.

export const THEME_IDS = ['party', 'midnight', 'neon', 'warm', 'clean'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface ThemeInfo {
  id: ThemeId
  name: string
  blurb: string
  /** swatch colours for pickers: background, unsung text, sung text */
  swatch: [string, string, string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'party', name: 'Party', blurb: 'Candy colours and stickers', swatch: ['#3a1fa0', '#ffffff', '#ffd23f'] },
  { id: 'midnight', name: 'Midnight', blurb: 'Dark and calm, glowing lyrics. For ballads', swatch: ['#0b1026', '#8d97c4', '#e8ecff'] },
  { id: 'neon', name: 'Neon', blurb: '80s synth, grid and sunset', swatch: ['#1a0533', '#7ef9ff', '#ff3fb4'] },
  { id: 'warm', name: 'Warm', blurb: 'Soft gradients and a serif. Acoustic, love songs', swatch: ['#5a2a1c', '#f6dcc4', '#ffb36b'] },
  { id: 'clean', name: 'Clean', blurb: 'Plain and high contrast. Best over video', swatch: ['#000000', '#bdbdbd', '#ffffff'] }
]

export const DEFAULT_THEME: ThemeId = 'party'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
