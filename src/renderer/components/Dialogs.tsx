import { useEffect, useRef, useState } from 'react'
import type { ImportAction, ImportCandidate, Mode, Song } from '../../shared/types'
import { ALL_TONICS, formatTranspose, keyName, tonicName } from '../../shared/keys'
import { THEMES, isThemeId, themeInfo, DEFAULT_THEME } from '../../shared/themes'
import { api } from '../api'
import { useUi } from '../stores/ui'
import { useLibrary } from '../stores/library'
import { usePlayer } from '../stores/player'
import { IconMinus, IconPlus, IconX } from './icons'
import { addToQueue, exportSongs, newPlaylistFrom, playNow, toggleFavorite } from './songActions'
import mascotCheer from '../assets/mascot_cheer.webp'

const base = (p: string | null): string => (p ? p.split(/[\\/]/).pop()! : '')
const isAudio = (p: string): boolean => /\.(mp3|wav|flac)$/i.test(p)
const isVideo = (p: string): boolean => /\.(mp4|m4v|mov|webm)$/i.test(p)

function useEscape(onClose: () => void): void {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [onClose])
}

// ---------------------------------------------------------------- import

export async function startImport(paths: string[]): Promise<void> {
  const ui = useUi.getState()
  if (paths.length === 0) return
  ui.set({ importOpen: true, importLoading: true, candidates: [] })
  try {
    const { candidates, problems } = await api.invoke('importer:analyse', paths)
    useUi.getState().set({ candidates, importLoading: false })
    for (const p of problems.slice(0, 5)) ui.toast(p, 'error', 8000)
    if (problems.length > 5) ui.toast(`…and ${problems.length - 5} more problems`, 'error', 8000)
    if (candidates.length === 0) {
      useUi.getState().set({ importOpen: false })
      if (problems.length === 0) ui.toast('No songs found. Drop MP3, WAV or FLAC files (plus optional vocals, lyrics and video), or a .karaokay file.', 'error', 5000)
    }
  } catch (e) {
    useUi.getState().set({ importOpen: false, importLoading: false })
    ui.toast(`Import failed: ${e instanceof Error ? e.message : e}`, 'error')
  }
}

export async function pickAndImport(): Promise<void> {
  const paths = await api.invoke('importer:pickFiles')
  await startImport(paths)
}

function FileRole({ role, cls, value, options, onChange, noneText }: { role: string; cls: string; value: string | null; options: string[]; onChange: (v: string | null) => void; noneText: string }) {
  return (
    <>
      <span className={`role ${cls}`}>{role}</span>
      <span className={`fname ${value ? '' : 'none'}`} title={value ?? ''}>
        {value ? base(value) : noneText}
      </span>
      <select aria-label={`Choose ${role} file`} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{role === 'Instrumental' ? 'Choose…' : 'None'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {base(o)}
          </option>
        ))}
      </select>
    </>
  )
}

/** read-only file list for a song inside a .karaokay package */
function PackageFiles({ c }: { c: ImportCandidate }) {
  const rows: [string, string, string | null][] = [
    ['Instrumental', 'inst', c.instrumental],
    ['Vocal', 'voc', c.vocals],
    ['Lyrics', 'lrc', c.lyrics],
    ...(c.video ? ([['Video', 'vid', c.video]] as [string, string, string][]) : [])
  ]
  const mb = Math.max(1, Math.round((c.pkg?.bytes ?? 0) / 1048576))
  return (
    <div className="imp-files">
      {rows.map(([role, cls, v]) => (
        <span key={role} style={{ display: 'contents' }}>
          <span className={`role ${cls}`}>{role}</span>
          <span className={`fname ${v ? '' : 'none'}`} style={{ gridColumn: 'span 2' }}>
            {v ?? 'none'}
          </span>
        </span>
      ))}
      <span className="role">Package</span>
      <span className="fname" style={{ gridColumn: 'span 2' }} title={c.pkg?.file}>
        {base(c.pkg?.file ?? null)} · {mb} MB{c.cover ? ' · with cover' : ''}
      </span>
    </div>
  )
}

export function ImportDialog() {
  const open = useUi((s) => s.importOpen)
  const loading = useUi((s) => s.importLoading)
  const candidates = useUi((s) => s.candidates)
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const updateToast = useUi((s) => s.updateToast)
  const dismiss = useUi((s) => s.dismissToast)
  const importMode = usePlayer((s) => s.settings?.importMode ?? 'copy')
  const root = usePlayer((s) => s.settings?.libraryRoot ?? '')
  const [pasting, setPasting] = useState<Set<string>>(new Set())
  const close = (): void => {
    set({ importOpen: false, candidates: [] })
    setPasting(new Set())
  }
  useEscape(close)
  if (!open) return null
  const togglePaste = (key: string): void => {
    const next = new Set(pasting)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPasting(next)
  }

  const patch = (key: string, p: Partial<ImportCandidate>): void => set({ candidates: candidates.map((c) => (c.key === key ? { ...c, ...p } : c)) })
  const todo = candidates.filter((c) => c.action !== 'skip' && c.instrumental)

  const commit = async (): Promise<void> => {
    close()
    const id = toast(`Importing ${todo.length} song${todo.length === 1 ? '' : 's'}…`, 'info', 0)
    const off = api.on('importer:progress', (p) => updateToast(id, { progress: p.total ? p.done / p.total : 0 }))
    try {
      const r = await api.invoke('importer:commit', todo)
      dismiss(id)
      const timing = todo.filter((c) => !c.lyrics && c.lyricsText?.trim() && c.vocals).length
      if (r.imported.length) toast(`Imported ${r.imported.length} song${r.imported.length === 1 ? '' : 's'}. Detecting keys${timing ? ' and timing lyrics' : ''}…`, 'ok')
      for (const f of r.failed) toast(`Couldn't import ${f.name}: ${f.reason}`, 'error', 8000)
    } finally {
      off()
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog" role="dialog" aria-modal aria-labelledby="imp-title">
        <img className="mascot" src={mascotCheer} alt="" />
        <header>
          <h2 id="imp-title">Import songs</h2>
          <p>{loading ? 'Looking through your files…' : `Found ${candidates.length} song${candidates.length === 1 ? '' : 's'}. Check who's who, then let's go!`}</p>
        </header>
        <div className="body">
          {candidates.map((c) => {
            const audio = c.pool.filter(isAudio)
            const lyricFiles = c.pool.filter((p) => /\.(srt|lrc|txt)$/i.test(p))
            const pasted = !c.lyrics && !!c.lyricsText?.trim()
            const warn = !c.instrumental ? 'Needs instrumental' : c.duplicateOf ? 'Already in library' : !c.lyrics && !pasted ? 'No lyrics yet' : null
            const showPaste = !c.pkg && !c.lyrics && (pasting.has(c.key) || pasted)
            return (
              <article key={c.key} className={`imp-card ${warn ? 'warn' : ''} ${c.action === 'skip' ? 'skip' : ''}`}>
                <div className="top">
                  <input type="text" aria-label="Title" value={c.title} onChange={(e) => patch(c.key, { title: e.target.value })} />
                  <input type="text" aria-label="Artist" value={c.artist} onChange={(e) => patch(c.key, { artist: e.target.value })} />
                  <input type="text" aria-label="Genre" placeholder="Genre" value={c.genre ?? ''} style={{ flex: '0 1 120px' }} onChange={(e) => patch(c.key, { genre: e.target.value || null })} />
                  {c.duplicateOf ? (
                    <select aria-label="Duplicate handling" value={c.action} onChange={(e) => patch(c.key, { action: e.target.value as ImportAction })}>
                      <option value="skip">Skip</option>
                      <option value="replace">Replace</option>
                      <option value="keepBoth">Keep both</option>
                    </select>
                  ) : (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800 }}>
                      <input type="checkbox" checked={c.action !== 'skip'} onChange={(e) => patch(c.key, { action: e.target.checked ? 'import' : 'skip' })} />
                      Import
                    </label>
                  )}
                  <span className={`pill ${warn ? 'sun' : 'mint'}`}>{warn ?? (pasted ? (c.vocals ? 'Lyrics get timed' : 'Ready') : 'Ready')}</span>
                </div>
                {c.pkg ? (
                  <PackageFiles c={c} />
                ) : (
                <div className="imp-files">
                  <FileRole role="Instrumental" cls="inst" value={c.instrumental} options={audio} noneText="none, choose a file" onChange={(v) => patch(c.key, { instrumental: v })} />
                  <FileRole role="Vocal" cls="voc" value={c.vocals} options={audio} noneText="none, instrumental only" onChange={(v) => patch(c.key, { vocals: v })} />
                  <FileRole role="Lyrics" cls="lrc" value={c.lyrics} options={lyricFiles} noneText={pasted ? 'pasted below' : 'none'} onChange={(v) => patch(c.key, { lyrics: v })} />
                  {(c.video || c.pool.some(isVideo)) && (
                    <FileRole role="Video" cls="vid" value={c.video} options={c.pool.filter(isVideo)} noneText="none" onChange={(v) => patch(c.key, { video: v })} />
                  )}
                  {!c.lyrics && !showPaste && (
                    <button className="btn xs imp-paste-btn" onClick={() => togglePaste(c.key)}>
                      Paste lyrics…
                    </button>
                  )}
                </div>
                )}
                {showPaste && !c.pkg && (
                  <div className="imp-paste">
                    <textarea
                      aria-label={`Lyrics for ${c.title}`}
                      value={c.lyricsText ?? ''}
                      onChange={(e) => patch(c.key, { lyricsText: e.target.value || null })}
                      placeholder={'Paste the lyrics, one karaoke line per line.\nWrite repeated choruses out in full.'}
                      spellCheck={false}
                      autoFocus={!pasted}
                    />
                    <span className="hint">
                      {c.vocals
                        ? 'Timed against the vocal track after import. You can check it in the lyrics editor.'
                        : 'No vocal track, so these are saved for now. Time them later with “Lyrics from text…” and the original recording.'}
                      {pasted && (
                        <button className="btn xs ghost" onClick={() => (patch(c.key, { lyricsText: null }), togglePaste(c.key))}>
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </article>
            )
          })}
        </div>
        <footer>
          <span className="note">
            {importMode === 'move' ? 'Moved' : 'Copied'} to {root} · keys are detected in the background
          </span>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={loading || todo.length === 0} onClick={() => void commit()}>
            Import {todo.length} song{todo.length === 1 ? '' : 's'}
          </button>
        </footer>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- song details

export function SongDetailsDialog() {
  const id = useUi((s) => s.detailsSongId)
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const genres = useLibrary((s) => s.genres)
  const [song, setSong] = useState<Song | null>(null)
  const [form, setForm] = useState({ title: '', artist: '', album: '', genre: '', year: '', language: '', tonic: -1, mode: 'major' as Mode, transpose: 0, lyricsOffsetMs: 0, vocalOffsetMs: 0, videoOffset: '0', theme: '' })
  const close = (): void => set({ detailsSongId: null })
  useEscape(close)
  useEffect(() => {
    if (!id) return
    void api.invoke('library:get', id).then((s) => {
      setSong(s)
      if (s)
        setForm({
          title: s.title,
          artist: s.artist,
          album: s.album ?? '',
          genre: s.genre ?? '',
          year: s.year ? String(s.year) : '',
          language: s.language ?? '',
          tonic: s.key?.tonic ?? -1,
          mode: s.key?.mode ?? 'major',
          transpose: s.transpose,
          lyricsOffsetMs: s.lyricsOffsetMs,
          vocalOffsetMs: s.vocalOffsetMs,
          videoOffset: String(s.videoOffsetMs / 1000),
          theme: s.theme ?? ''
        })
    })
  }, [id])
  if (!id || !song) return null
  const f = form
  const up = (p: Partial<typeof form>): void => setForm({ ...f, ...p })
  const keyChanged = f.tonic !== (song.key?.tonic ?? -1) || (f.tonic >= 0 && f.mode !== song.key?.mode)

  const save = async (): Promise<void> => {
    const updated = await api.invoke('library:update', song.id, {
      title: f.title,
      artist: f.artist,
      album: f.album || null,
      genre: f.genre || null,
      year: f.year ? Number(f.year) : null,
      language: f.language || null,
      transpose: f.transpose,
      lyricsOffsetMs: f.lyricsOffsetMs,
      vocalOffsetMs: f.vocalOffsetMs,
      theme: isThemeId(f.theme) ? f.theme : null,
      videoOffsetMs: Math.round((Number(f.videoOffset) || 0) * 1000),
      ...(keyChanged ? { key: f.tonic >= 0 ? { tonic: f.tonic, mode: f.mode, source: 'manual' as const, confidence: null } : null } : {})
    })
    usePlayer.getState().onSongUpdated(updated)
    if (usePlayer.getState().current?.id === updated.id) usePlayer.getState().setTranspose(updated.transpose)
    close()
    toast('Saved', 'ok', 1500)
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog narrow" role="dialog" aria-modal aria-labelledby="sd-title">
        <header>
          <h2 id="sd-title">Song details</h2>
          <p>Saved to song.json in the song folder. Audio files are never changed.</p>
        </header>
        <div className="body">
          <label className="field">
            <span className="label">Title</span>
            <input type="text" value={f.title} onChange={(e) => up({ title: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Artist</span>
            <input type="text" value={f.artist} onChange={(e) => up({ artist: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Album</span>
            <input type="text" value={f.album} onChange={(e) => up({ album: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Genre</span>
            <input type="text" list="genre-list" value={f.genre} onChange={(e) => up({ genre: e.target.value })} />
            <datalist id="genre-list">
              {genres.map((g) => (
                <option key={g.name} value={g.name} />
              ))}
            </datalist>
          </label>
          <div className="field">
            <span className="label">Year / language</span>
            <div className="two">
              <input type="number" aria-label="Year" value={f.year} onChange={(e) => up({ year: e.target.value })} />
              <input type="text" aria-label="Language" placeholder="e.g. en" value={f.language} onChange={(e) => up({ language: e.target.value })} />
            </div>
          </div>
          <span className="label section-label">Key</span>
          <div className="field">
            <span className="label">Original key</span>
            <div className="two">
              <select aria-label="Tonic" value={f.tonic} onChange={(e) => up({ tonic: Number(e.target.value) })}>
                <option value={-1}>Unknown</option>
                {ALL_TONICS.map((t) => (
                  <option key={t} value={t}>
                    {tonicName(t, f.mode)}
                  </option>
                ))}
              </select>
              <select aria-label="Mode" value={f.mode} onChange={(e) => up({ mode: e.target.value as Mode })}>
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </div>
            <span className="hint">
              {song.key?.source === 'manual' ? (
                'Set by you. Re-analysis will not overwrite it.'
              ) : song.key ? (
                <>
                  Detected <b>{keyName(song.key)}</b> · confidence {Math.round((song.key.confidence ?? 0) * 100)}%. Major/minor mix-ups are common; fix it here.
                </>
              ) : song.analysisStatus === 'failed' ? (
                'Detection failed.'
              ) : (
                'Detecting…'
              )}{' '}
              <button
                className="btn sm ghost"
                style={{ height: 26, marginLeft: 4 }}
                onClick={async () => {
                  await api.invoke('analysis:reset', song.id)
                  close()
                  toast('Re-analysing key…', 'info', 2000)
                }}
              >
                Re-analyse
              </button>
            </span>
          </div>
          <div className="field">
            <span className="label">My key</span>
            <div className="key-ctl">
              <button className="step-btn" aria-label="Lower" onClick={() => up({ transpose: Math.max(-6, f.transpose - 1) })}>
                <IconMinus size={13} />
              </button>
              <div className="key-read">
                <b>{f.tonic >= 0 ? keyName({ tonic: f.tonic, mode: f.mode }, f.transpose) : 'Original'}</b>
                <small>{formatTranspose(f.transpose)} semitones</small>
              </div>
              <button className="step-btn" aria-label="Raise" onClick={() => up({ transpose: Math.min(6, f.transpose + 1) })}>
                <IconPlus size={13} />
              </button>
            </div>
          </div>
          <span className="label section-label">Lyrics</span>
          <div className="field">
            <span className="label">From text</span>
            <div>
              <button
                className="btn sm"
                onClick={() => {
                  close()
                  set({ lyricsSongId: song.id })
                }}
              >
                {song.hasLyrics ? 'Re-time lyrics from text…' : 'Paste lyrics and time them…'}
              </button>
              {song.hasLyrics && (
                <button
                  className="btn sm"
                  style={{ marginLeft: 8 }}
                  onClick={() => {
                    close()
                    set({ editor: { songId: song.id } })
                  }}
                >
                  Edit lyrics…
                </button>
              )}
            </div>
          </div>
          <span className="label section-label">Focus mode</span>
          <div className="field">
            <span className="label">Theme</span>
            <select aria-label="Focus theme" value={f.theme} onChange={(e) => up({ theme: e.target.value })}>
              <option value="">Default ({song.hasVideo ? 'Clean, best over video' : themeInfo(usePlayer.getState().settings?.focusTheme ?? DEFAULT_THEME).name})</option>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}: {t.blurb}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="label">Background video</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn sm"
                onClick={async () => {
                  const updated = await api.invoke('library:setVideo', song.id, 'pick')
                  if (updated) {
                    setSong(updated)
                    usePlayer.getState().onSongUpdated(updated)
                  }
                }}
              >
                {song.hasVideo ? 'Replace…' : 'Add video…'}
              </button>
              {song.hasVideo && (
                <button
                  className="btn sm ghost"
                  onClick={async () => {
                    const updated = await api.invoke('library:setVideo', song.id, 'remove')
                    if (updated) {
                      setSong(updated)
                      usePlayer.getState().onSongUpdated(updated)
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            <span className="hint">Plays muted behind the lyrics in focus mode. MP4 (H.264) or WebM.</span>
          </div>
          {song.hasVideo && (
            <div className="field">
              <span className="label">Video start</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" step={0.1} style={{ width: 110 }} value={f.videoOffset} onChange={(e) => up({ videoOffset: e.target.value })} />
                <span>s into the video when the song starts (skip an intro)</span>
              </div>
            </div>
          )}
          <span className="label section-label">Sync</span>
          <div className="field">
            <span className="label">Lyric offset</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="number" step={50} style={{ width: 110 }} value={f.lyricsOffsetMs} onChange={(e) => up({ lyricsOffsetMs: Number(e.target.value) || 0 })} />
              <span>ms (positive shows lyrics later)</span>
            </div>
          </div>
          {song.hasVocals && (
            <div className="field">
              <span className="label">Vocal offset</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" step={10} style={{ width: 110 }} value={f.vocalOffsetMs} onChange={(e) => up({ vocalOffsetMs: Number(e.target.value) || 0 })} />
                <span>ms (positive delays the vocal file)</span>
              </div>
            </div>
          )}
        </div>
        <footer>
          <button className="btn sm ghost" onClick={() => void api.invoke('library:reveal', song.id)}>
            Show in Finder
          </button>
          <span className="note" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void save()}>
            Save
          </button>
        </footer>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- prompt

export function PromptDialog() {
  const prompt = useUi((s) => s.prompt)
  const set = useUi((s) => s.set)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (prompt) {
      setValue(prompt.value)
      setTimeout(() => ref.current?.select(), 20)
    }
  }, [prompt])
  const close = (): void => set({ prompt: null })
  useEscape(close)
  if (!prompt) return null
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form
        className="dialog narrow"
        role="dialog"
        aria-modal
        aria-labelledby="pr-title"
        onSubmit={(e) => {
          e.preventDefault()
          prompt.onSubmit(value.trim())
          close()
        }}
      >
        <header>
          <h2 id="pr-title">{prompt.title}</h2>
        </header>
        <div className="body">
          <label className="field">
            <span className="label">{prompt.label}</span>
            <input ref={ref} type="text" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </label>
        </div>
        <footer>
          <span className="note" />
          <button type="button" className="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </footer>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- context menu

export function ContextMenu() {
  const ctx = useUi((s) => s.ctx)
  const set = useUi((s) => s.set)
  const toast = useUi((s) => s.toast)
  const playlists = useLibrary((s) => s.playlists)
  const [sub, setSub] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    setSub(false)
    if (!ctx) return
    const close = (e: Event): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      set({ ctx: null })
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') set({ ctx: null })
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', key)
    }
  }, [ctx, set])
  useEffect(() => {
    if (!ctx || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(ctx.x, window.innerWidth - r.width - 8), y: Math.min(ctx.y, window.innerHeight - r.height - 8) })
    ref.current.querySelector('button')?.focus()
  }, [ctx, sub])
  if (!ctx) return null
  const s = ctx.song
  const run = (fn: () => void | Promise<void>) => () => {
    set({ ctx: null })
    void fn()
  }
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {sub ? (
        <>
          <button role="menuitem" onClick={() => setSub(false)}>
            ‹ Back
          </button>
          <hr />
          <div className="sub">
            {playlists.map((p) => (
              <button
                key={p.id}
                role="menuitem"
                onClick={run(async () => {
                  await api.invoke('playlists:addSongs', p.id, [s.id])
                  await useLibrary.getState().refreshPlaylists()
                  useLibrary.setState({ version: useLibrary.getState().version + 1 })
                  toast(`Added to “${p.name}”`, 'ok', 2000)
                })}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button role="menuitem" onClick={run(() => newPlaylistFrom([s.id]))}>
            New playlist…
          </button>
        </>
      ) : (
        <>
          <button role="menuitem" disabled={s.missing} onClick={run(() => playNow(s))}>
            Play now <kbd>⌘↵</kbd>
          </button>
          <button role="menuitem" disabled={s.missing} onClick={run(() => addToQueue([s], 'next'))}>
            Play next <kbd>⇧↵</kbd>
          </button>
          <button role="menuitem" disabled={s.missing} onClick={run(() => addToQueue([s]))}>
            Add to queue <kbd>↵</kbd>
          </button>
          <button role="menuitem" onClick={() => setSub(true)}>
            Add to playlist <span>›</span>
          </button>
          <button role="menuitem" onClick={run(() => toggleFavorite(s))}>
            {s.favorite ? 'Unfavorite' : 'Favorite'}
          </button>
          {ctx.extra && ctx.extra.length > 0 && <hr />}
          {ctx.extra?.map((x) => (
            <button key={x.label} role="menuitem" className={x.danger ? 'danger' : ''} onClick={run(x.run)}>
              {x.label}
            </button>
          ))}
          <hr />
          <button role="menuitem" onClick={run(() => set({ detailsSongId: s.id }))}>
            Song details…
          </button>
          {s.hasLyrics && (
            <button role="menuitem" onClick={run(() => set({ editor: { songId: s.id } }))}>
              Edit lyrics…
            </button>
          )}
          <button role="menuitem" onClick={run(() => set({ lyricsSongId: s.id }))}>
            {s.hasLyrics ? 'Re-time lyrics from text…' : 'Lyrics from text…'}
          </button>
          <button
            role="menuitem"
            onClick={run(async () => {
              const updated = await api.invoke('library:setVideo', s.id, 'pick')
              if (updated) {
                usePlayer.getState().onSongUpdated(updated)
                useUi.getState().toast(`Background video added to “${updated.title}”`, 'ok', 2500)
              }
            })}
          >
            {s.hasVideo ? 'Replace background video…' : 'Add background video…'}
          </button>
          <button role="menuitem" disabled={s.missing} onClick={run(() => exportSongs([s.id]))}>
            Export as .karaokay…
          </button>
          <button role="menuitem" onClick={run(() => api.invoke('library:reveal', s.id))}>
            Show in Finder
          </button>
          <button
            role="menuitem"
            className="danger"
            onClick={run(async () => {
              await api.invoke('library:remove', s.id, true)
              toast(`Moved “${s.title}” to the Trash`, 'info', 3000)
            })}
          >
            Remove from library
          </button>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- toasts

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.progress !== undefined && (
            <span className="bar">
              <i style={{ width: `${Math.round(t.progress * 100)}%` }} />
            </span>
          )}
          <button className="icon-btn xs" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <IconX size={10} />
          </button>
        </div>
      ))}
    </div>
  )
}
