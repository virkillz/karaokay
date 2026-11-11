import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useLibrary } from '../stores/library'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { searchTerms } from './common'
import { IconSearch, IconX } from './icons'
import { SongRow } from './SongRow'
import { addToQueue, playNow } from './songActions'

const ROW = 62
const MAIN_GENRES = 6

export function SearchCard() {
  const text = useLibrary((s) => s.text)
  const setText = useLibrary((s) => s.setText)
  const results = useLibrary((s) => s.results)
  const total = useLibrary((s) => s.total)
  const genre = useLibrary((s) => s.genre)
  const genres = useLibrary((s) => s.genres)
  const hasVocals = useLibrary((s) => s.hasVocals)
  const hasLyrics = useLibrary((s) => s.hasLyrics)
  const sort = useLibrary((s) => s.sort)
  const setFilter = useLibrary((s) => s.setFilter)
  const currentId = usePlayer((s) => s.current?.id)
  const [sel, setSel] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const terms = useMemo(() => searchTerms(text), [text])

  const topGenres = useMemo(() => [...genres].sort((a, b) => b.count - a.count).slice(0, MAIN_GENRES).map((g) => g.name), [genres])
  const moreGenres = useMemo(() => genres.map((g) => g.name).filter((g) => !topGenres.includes(g)), [genres, topGenres])

  const virt = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (results[i]?.snippet ? ROW + 16 : ROW),
    overscan: 8
  })

  useEffect(() => setSel(0), [text, genre, hasVocals, hasLyrics])
  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('karaokay:focus-search', focus)
    return () => window.removeEventListener('karaokay:focus-search', focus)
  }, [])

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const n = Math.min(results.length - 1, sel + 1)
      setSel(n)
      virt.scrollToIndex(n)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const n = Math.max(0, sel - 1)
      setSel(n)
      virt.scrollToIndex(n)
    } else if (e.key === 'Enter') {
      const song = results[sel]
      if (!song) return
      e.preventDefault()
      if (e.metaKey || e.ctrlKey) void playNow(song)
      else void addToQueue([song], e.shiftKey ? 'next' : 'end')
    } else if (e.key === 'Escape') {
      if (text) {
        e.stopPropagation()
        setText('')
      } else inputRef.current?.blur()
    }
  }

  return (
    <section className="card search-card" aria-label="Find a song">
      <label className="search-box">
        <IconSearch />
        <span className="sr-only">Search songs, artists, genres or lyrics</span>
        <input
          ref={inputRef}
          type="search"
          data-search
          placeholder="Search songs, artists, lyrics…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
        {text ? (
          <>
            <span className="hits">
              {total} {total === 1 ? 'hit' : 'hits'}
            </span>
            <button className="icon-btn xs" aria-label="Clear search" onClick={() => setText('')}>
              <IconX size={12} />
            </button>
          </>
        ) : (
          <kbd>⌘K</kbd>
        )}
      </label>
      <div className="chips" role="group" aria-label="Filters">
        <button className={`chip ${genre === null ? 'on' : ''}`} onClick={() => setFilter({ genre: null })}>
          All
        </button>
        {topGenres.map((g) => (
          <button key={g} className={`chip ${genre === g ? 'on' : ''}`} onClick={() => setFilter({ genre: genre === g ? null : g })}>
            {g}
          </button>
        ))}
        {moreGenres.length > 0 && (
          <select
            aria-label="More genres"
            value={moreGenres.includes(genre ?? '') ? genre! : ''}
            onChange={(e) => setFilter({ genre: e.target.value || null })}
            className={moreGenres.includes(genre ?? '') ? 'chip on' : 'chip'}
          >
            <option value="">More…</option>
            {moreGenres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        <button className={`chip toggle ${hasVocals ? 'on' : ''}`} aria-pressed={hasVocals} onClick={() => setFilter({ hasVocals: !hasVocals })}>
          Has vocal
        </button>
        <button className={`chip toggle ${hasLyrics ? 'on' : ''}`} aria-pressed={hasLyrics} onClick={() => setFilter({ hasLyrics: !hasLyrics })}>
          Has lyrics
        </button>
        <select aria-label="Sort" value={sort} onChange={(e) => setFilter({ sort: e.target.value as typeof sort })} className="chip">
          <option value="relevance">{text ? 'Best match' : 'Newest'}</option>
          <option value="title">Title A–Z</option>
          <option value="artist">Artist A–Z</option>
          <option value="added">Recently added</option>
          <option value="plays">Most sung</option>
        </select>
      </div>
      <div className="results" ref={scrollRef}>
        {results.length === 0 ? (
          <div className="empty-note">
            <span>{text ? `No songs match “${text}”.` : 'No songs here yet.'}</span>
            {(genre || hasVocals || hasLyrics || text) && (
              <button
                className="btn sm"
                onClick={() => {
                  setText('')
                  setFilter({ genre: null, hasVocals: false, hasLyrics: false })
                }}
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((v) => {
              const song = results[v.index]
              return (
                <SongRow
                  key={song.id}
                  song={song}
                  terms={terms}
                  playing={song.id === currentId}
                  selected={v.index === sel && !!text}
                  style={{ top: v.start, height: v.size - 4 }}
                  onSelect={() => setSel(v.index)}
                />
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

export function focusSearch(): void {
  const ui = useUi.getState()
  if (ui.view !== 'sing' || ui.focus) {
    ui.set({ view: 'sing', focus: false })
    setTimeout(() => window.dispatchEvent(new Event('karaokay:focus-search')), 30)
  } else window.dispatchEvent(new Event('karaokay:focus-search'))
}
