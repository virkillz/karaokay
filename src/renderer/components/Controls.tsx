import { keyName, formatTranspose, tonicName, TRANSPOSE_MAX, TRANSPOSE_MIN } from '../../shared/keys'
import { usePlayer } from '../stores/player'
import { engine } from '../audio/engine'
import { Slider, formatTime, usePosition } from './common'
import { IconMinus, IconPause, IconPlay, IconPlus, IconRestart, IconSkip } from './icons'

export function KeyControl({ compact = false }: { compact?: boolean }) {
  const current = usePlayer((s) => s.current)
  const transpose = usePlayer((s) => s.transpose)
  const step = usePlayer((s) => s.stepTranspose)
  const key = current?.key ?? null
  return (
    <div className={compact ? 'ctl-group inline' : 'ctl-group'}>
      <span className="label">Key</span>
      <div className="key-ctl">
        <button className="step-btn" aria-label="Key down a semitone" title="Key down  [" disabled={!current || transpose <= TRANSPOSE_MIN} onClick={() => step(-1)}>
          <IconMinus size={13} />
        </button>
        <div className={`key-read ${compact ? 'compact' : ''}`} aria-live="polite">
          {compact ? (
            <b>
              {key ? tonicName(key.tonic + transpose, key.mode) : '–'} · {formatTranspose(transpose)}
            </b>
          ) : (
            <>
              <b>{key ? keyName(key, transpose) : transpose === 0 ? 'Original' : formatTranspose(transpose)}</b>
              <small>{key ? `orig. ${tonicName(key.tonic, key.mode)}${key.mode === 'minor' ? 'm' : ''} · ${formatTranspose(transpose)}` : current?.analysisStatus === 'pending' ? 'detecting key…' : `${formatTranspose(transpose)} semitones`}</small>
            </>
          )}
        </div>
        <button className="step-btn" aria-label="Key up a semitone" title="Key up  ]" disabled={!current || transpose >= TRANSPOSE_MAX} onClick={() => step(1)}>
          <IconPlus size={13} />
        </button>
      </div>
    </div>
  )
}

export function Transport({ big = true }: { big?: boolean }) {
  const state = usePlayer((s) => s.state)
  const current = usePlayer((s) => s.current)
  const queueLen = usePlayer((s) => s.queue.length)
  const toggle = usePlayer((s) => s.toggle)
  const skip = usePlayer((s) => s.skip)
  const restart = usePlayer((s) => s.restart)
  const playing = state === 'playing'
  return (
    <div className="transport">
      {big && (
        <button className="icon-btn" aria-label="Restart song" title="Restart  R" disabled={!current} onClick={restart}>
          <IconRestart />
        </button>
      )}
      <button className="icon-btn play" aria-label={playing ? 'Pause' : 'Play'} title="Play / pause  Space" disabled={!current && queueLen === 0} onClick={toggle}>
        {state === 'loading' ? <span className="spin" aria-hidden>…</span> : playing ? <IconPause /> : <IconPlay />}
      </button>
      <button className="icon-btn" aria-label="Skip to next song" title="Skip  N" disabled={!current && queueLen === 0} onClick={() => void skip()}>
        <IconSkip />
      </button>
    </div>
  )
}

export function SeekBar() {
  const pos = usePosition(8)
  const duration = usePlayer((s) => s.duration)
  const current = usePlayer((s) => s.current)
  return (
    <div className="seek-wrap num">
      <span>{formatTime(current ? pos : 0)}</span>
      <Slider
        className="seek"
        label="Song position"
        value={current ? pos : 0}
        max={current ? Math.max(duration, 0.1) : 1}
        step={5}
        color="var(--pink)"
        valueText={`${formatTime(pos)} of ${formatTime(duration)}`}
        onChange={(v) => current && engine.seek(v)}
      />
      <span>{formatTime(current ? duration : 0)}</span>
    </div>
  )
}

export function VocalSlider({ inline = false }: { inline?: boolean }) {
  const vocal = usePlayer((s) => s.vocalLevel)
  const set = usePlayer((s) => s.setVocalLevel)
  const current = usePlayer((s) => s.current)
  if (current && !current.hasVocals) return null
  return (
    <div className={inline ? 'ctl-group inline' : 'ctl-group'} style={{ minWidth: 110 }}>
      <span className="label">Guide vocal</span>
      <Slider label="Guide vocal level" value={vocal} onChange={set} color="var(--mint)" valueText={`${Math.round(vocal * 100)}%`} />
    </div>
  )
}

export function VolumeSlider() {
  const vol = usePlayer((s) => s.volume)
  const set = usePlayer((s) => s.setVolume)
  return (
    <div className="ctl-group" style={{ minWidth: 110 }}>
      <span className="label">Volume</span>
      <Slider label="Volume" value={vol} onChange={set} color="var(--violet)" valueText={`${Math.round(vol * 100)}%`} />
    </div>
  )
}

export function LyricSync() {
  const current = usePlayer((s) => s.current)
  const nudge = usePlayer((s) => s.nudgeLyrics)
  if (!current?.hasLyrics) return null
  const ms = current.lyricsOffsetMs
  return (
    <div className="ctl-group inline">
      <span className="label">Lyric sync</span>
      <button className="step-btn" aria-label="Lyrics earlier by 50 ms" title="Lyrics earlier  ," onClick={() => nudge(-50)}>
        <IconMinus size={13} />
      </button>
      <span className="num" style={{ minWidth: 70, textAlign: 'center', fontWeight: 900 }}>
        {ms > 0 ? '+' : ms < 0 ? '−' : ''}
        {Math.abs(ms)} ms
      </span>
      <button className="step-btn" aria-label="Lyrics later by 50 ms" title="Lyrics later  ." onClick={() => nudge(50)}>
        <IconPlus size={13} />
      </button>
    </div>
  )
}
