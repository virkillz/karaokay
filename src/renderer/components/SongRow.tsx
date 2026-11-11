import type { CSSProperties } from 'react'
import type { Song } from '../../shared/types'
import { keyShort } from '../../shared/keys'
import { Cover, Highlight, formatTime } from './common'
import { IconHeart, IconPlayNext, IconPlus } from './icons'
import { addToQueue, openSongMenu } from './songActions'
import { useUi } from '../stores/ui'

interface Props {
  song: Song
  terms?: string[]
  playing?: boolean
  selected?: boolean
  style?: CSSProperties
  className?: string
  /** extra line under the artist, e.g. history time */
  extra?: string
  menuExtra?: { label: string; run: () => void; danger?: boolean }[]
  onSelect?: () => void
}

export function SongRow({ song, terms = [], playing, selected, style, className = '', extra, menuExtra, onSelect }: Props) {
  const key = song.key ? keyShort(song.key) : song.analysisStatus === 'failed' ? '?' : '…'
  return (
    <div
      className={`song-row ${playing ? 'playing' : ''} ${selected ? 'sel' : ''} ${song.missing ? 'missing' : ''} ${className}`}
      style={style}
      onDoubleClick={() => void addToQueue([song])}
      onContextMenu={(e) => openSongMenu(e, song, menuExtra)}
      onMouseDown={onSelect}
      title={song.missing ? 'Files are missing from the library folder' : undefined}
    >
      <Cover song={song} />
      <div className="info">
        <span className="t">
          <Highlight text={song.title} terms={terms} />
          {song.favorite && (
            <span className="fav" style={{ marginLeft: 6 }} aria-label="favourite">
              <IconHeart filled size={13} />
            </span>
          )}
        </span>
        <span className="s">
          <Highlight text={song.artist} terms={terms} />
          {song.genre ? ` · ${song.genre}` : ''} · <span className="num">{formatTime(song.durationMs / 1000)}</span>
          {extra ? ` · ${extra}` : ''}
        </span>
        {song.snippet && <span className="snip">“{song.snippet}”</span>}
      </div>
      <span className="badges" aria-label={`${song.hasVocals ? 'has' : 'no'} guide vocal, ${song.hasLyrics ? 'has' : 'no'} lyrics`}>
        <span className={`badge ${song.hasVocals ? '' : 'off'}`}>VOC</span>
        {song.lyricsReview ? (
          <button
            className="badge check"
            title="Lyrics were timed automatically. Click to check them."
            onClick={(e) => (e.stopPropagation(), useUi.getState().set({ editor: { songId: song.id } }))}
          >
            CHECK
          </button>
        ) : song.lyricsDraft ? (
          <button
            className="badge wait"
            title={song.hasVocals ? 'Lyrics are waiting to be timed' : 'Pasted lyrics need timing: click to time them against the original recording'}
            onClick={(e) => (e.stopPropagation(), useUi.getState().set({ lyricsSongId: song.id }))}
          >
            LRC…
          </button>
        ) : (
          <span className={`badge ${song.hasLyrics ? '' : 'off'}`}>LRC</span>
        )}
      </span>
      <span className={`key-chip ${song.key ? '' : 'pending'}`} title={song.key ? `Original key${song.key.source === 'manual' ? ' (set by you)' : ''}` : 'Detecting key…'}>
        {key}
        {song.key && song.key.source === 'detected' && (song.key.confidence ?? 1) < 0.5 ? '?' : ''}
      </span>
      <span className="acts">
        <button className="icon-btn sm" aria-label={`Play ${song.title} next`} title="Play next" disabled={song.missing} onClick={() => void addToQueue([song], 'next')}>
          <IconPlayNext />
        </button>
        <button className="icon-btn sm pink" aria-label={`Add ${song.title} to queue`} title="Add to queue" disabled={song.missing} onClick={() => void addToQueue([song])}>
          <IconPlus />
        </button>
      </span>
    </div>
  )
}
