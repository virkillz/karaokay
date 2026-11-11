import { useEffect, useRef, useState } from 'react'
import { DEFAULT_THEME, THEMES, themeInfo, type ThemeId } from '../../shared/themes'
import { api } from '../api'
import { mediaUrl } from '../../shared/ipc'
import type { Song } from '../../shared/types'
import { engine } from '../audio/engine'
import { keyName, formatTranspose, keyShort } from '../../shared/keys'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { Cover, usePosition } from './common'
import { KeyControl, LyricSync, SeekBar, Transport, VocalSlider, VolumeSlider } from './Controls'
import { LyricLines, useLyricFrame } from './Lyrics'
import { IconCollapse, IconExpand } from './icons'
import mascot from '../assets/mascot.webp'
import mascotCheer from '../assets/mascot_cheer.webp'
import disco from '../assets/disco.webp'
import star from '../assets/star.webp'
import note from '../assets/note.webp'
import heart from '../assets/heart.webp'

/** What "Default" means for a song: Clean over a video (readability), otherwise the Settings theme. */
function defaultThemeFor(song: Pick<Song, 'hasVideo'> | null, settingsTheme: ThemeId): ThemeId {
  return song?.hasVideo ? 'clean' : settingsTheme
}

/** The focus theme in effect for the playing song. */
export function useFocusTheme(): ThemeId {
  const songTheme = usePlayer((s) => s.current?.theme ?? null)
  const hasVideo = usePlayer((s) => !!s.current?.hasVideo)
  const def = usePlayer((s) => s.settings?.focusTheme ?? DEFAULT_THEME)
  return songTheme ?? defaultThemeFor({ hasVideo }, def)
}

const HARD_SYNC = 0.3 // seconds of drift before the video jumps instead of catching up

/** Muted background video slaved to the audio clock. */
function VideoBackground({ song }: { song: Song }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const v = ref.current
    if (!v || failed) return
    const tick = (): void => {
      if (v.readyState < 1 || v.seeking) return
      const target = engine.position + song.videoOffsetMs / 1000
      const dur = Number.isFinite(v.duration) ? v.duration : Infinity
      if (target < 0 || target >= dur) {
        // before the video starts or after it ends: hold the nearest frame
        if (!v.paused) v.pause()
        const hold = Math.max(0, Math.min(target, dur - 0.05))
        if (Math.abs(v.currentTime - hold) > HARD_SYNC) v.currentTime = hold
        return
      }
      const diff = target - v.currentTime
      if (Math.abs(diff) > HARD_SYNC) v.currentTime = target
      if (engine.isPlaying) {
        // small drift: nudge the speed rather than jumping
        v.playbackRate = Math.abs(diff) > 0.03 ? 1 + Math.max(-0.08, Math.min(0.08, diff * 0.6)) : 1
        if (v.paused) void v.play().catch(() => undefined)
      } else {
        if (!v.paused) v.pause()
        // paused: show exactly the right frame
        if (Math.abs(diff) > 0.04) v.currentTime = target
      }
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => clearInterval(id)
  }, [song.id, song.videoOffsetMs, failed])
  if (failed) return null
  return (
    <div className="video-bg" aria-hidden>
      <video
        ref={ref}
        src={mediaUrl(song.id, 'video', encodeURIComponent(song.folder))}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        onError={() => {
          setFailed(true)
          useUi.getState().toast(`Can't play the background video for “${song.title}”. MP4 (H.264) or WebM work best.`, 'error', 6000)
        }}
      />
    </div>
  )
}

export function Swatch({ id, className = '' }: { id: ThemeId; className?: string }) {
  const [bg, unsung, sung] = themeInfo(id).swatch
  return (
    <span className={`swatch ${className}`} style={{ background: bg }} aria-hidden>
      <span>
        <span style={{ color: sung }}>A</span>
        <span style={{ color: unsung }}>a</span>
      </span>
    </span>
  )
}

/** Pick this song's focus theme. */
function ThemeMenu() {
  const current = usePlayer((s) => s.current)
  const settingsTheme = usePlayer((s) => s.settings?.focusTheme ?? DEFAULT_THEME)
  const def = defaultThemeFor(current, settingsTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key, true)
    }
  }, [open])
  if (!current) return null
  const choose = async (theme: ThemeId | null): Promise<void> => {
    setOpen(false)
    const updated = await api.invoke('library:update', current.id, { theme })
    usePlayer.getState().onSongUpdated(updated)
  }
  return (
    <div className="theme-menu" ref={ref}>
      <button className="btn shadow" onClick={() => setOpen(!open)} aria-expanded={open} title="Theme for this song">
        <Swatch id={current.theme ?? def} className="sm" />
        Theme
      </button>
      {open && (
        <div className="theme-pop" role="menu">
          <span className="label">Theme for this song</span>
          <button role="menuitemradio" aria-checked={current.theme === null} className={`theme-opt ${current.theme === null ? 'on' : ''}`} onClick={() => void choose(null)}>
            <Swatch id={def} />
            <span>
              Default
              <small>{current.hasVideo ? `${themeInfo(def).name}, best over video` : `${themeInfo(def).name}, from Settings`}</small>
            </span>
          </button>
          {THEMES.map((t) => (
            <button key={t.id} role="menuitemradio" aria-checked={current.theme === t.id} className={`theme-opt ${current.theme === t.id ? 'on' : ''}`} onClick={() => void choose(t.id)}>
              <Swatch id={t.id} />
              <span>
                {t.name}
                <small>{t.blurb}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeDecorations({ theme }: { theme: ThemeId }) {
  if (theme === 'midnight')
    return (
      <div className="deco" aria-hidden>
        <div className="deco-stars" />
        <div className="deco-stars b" />
        <div className="deco-moon" />
      </div>
    )
  if (theme === 'neon')
    return (
      <div className="deco" aria-hidden>
        <div className="deco-sun" />
        <div className="deco-grid" />
      </div>
    )
  if (theme === 'warm')
    return (
      <div className="deco" aria-hidden>
        <div className="deco-blob a" />
        <div className="deco-blob b" />
        <div className="deco-blob c" />
      </div>
    )
  return null
}

function Decorations({ focus, theme, video }: { focus: boolean; theme: ThemeId; video: boolean }) {
  if (focus && video) return null
  if (focus && theme !== 'party') return <ThemeDecorations theme={theme} />
  return (
    <>
      {focus ? (
        <>
          <img className="sticker" src={disco} alt="" style={{ left: '50%', top: -60, width: 180, marginLeft: -90 }} />
          <img className="sticker" src={star} alt="" style={{ right: 60, top: '44%', width: 92, transform: 'rotate(16deg)' }} />
          <img className="sticker" src={heart} alt="" style={{ left: 30, top: 200, width: 66, transform: 'rotate(-18deg)' }} />
          <img className="sticker" src={mascot} alt="" style={{ left: 26, bottom: 150, width: 140, transform: 'rotate(-10deg)' }} />
          <img className="sticker" src={note} alt="" style={{ left: 160, bottom: 260, width: 56, transform: 'rotate(12deg)' }} />
        </>
      ) : (
        <>
          <img className="sticker" src={disco} alt="" style={{ right: -26, top: 80, width: 160, transform: 'rotate(12deg)' }} />
          <img className="sticker" src={star} alt="" style={{ left: 18, bottom: 130, width: 66, transform: 'rotate(-14deg)' }} />
          <img className="sticker" src={note} alt="" style={{ right: 50, bottom: 140, width: 74, transform: 'rotate(10deg)' }} />
        </>
      )}
      <span className="confetti" style={{ left: '44%', top: 120, width: 14, height: 14, borderRadius: '50%', background: 'var(--mint)' }} />
      <span className="confetti" style={{ left: '12%', top: 210, width: 10, height: 10, borderRadius: '50%', background: 'var(--sun)' }} />
      <span className="confetti" style={{ right: '22%', top: '46%', width: 12, height: 12, borderRadius: 3, transform: 'rotate(30deg)', background: 'var(--confetti-pink)' }} />
      <span className="confetti" style={{ left: '24%', bottom: '28%', width: 11, height: 11, borderRadius: 3, transform: 'rotate(-20deg)', background: 'var(--mint)' }} />
    </>
  )
}

function Interstitial() {
  const inter = usePlayer((s) => s.interstitial)
  const start = usePlayer((s) => s.startInterstitialNow)
  const cancel = usePlayer((s) => s.cancelInterstitial)
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])
  if (!inter) return null
  const left = Math.max(0, Math.ceil((inter.endsAt - Date.now()) / 1000))
  const s = inter.song
  return (
    <div className="interstitial" role="dialog" aria-label="Next song">
      <div className="box">
        <img className="mascot" src={mascotCheer} alt="" />
        <div>
          <div className="l">Up next</div>
          <div className="t">{s.title}</div>
          <div className="a">
            {s.artist}
            {s.key ? ` · ${keyName(s.key, s.transpose)}` : ''}
          </div>
          <div className="row">
            <button className="btn sun shadow" onClick={start} autoFocus>
              Start now
            </button>
            <button className="btn" onClick={cancel}>
              Pause queue
            </button>
            <span className="count num">starting in {left}s</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function IdleStage() {
  const queue = usePlayer((s) => s.queue)
  const toggle = usePlayer((s) => s.toggle)
  return (
    <div className="lyrics">
      <div className="idle-stage">
        <img src={mascot} alt="" />
        <h2>{queue.length ? 'Ready when you are!' : 'Pick a song to sing'}</h2>
        <p>{queue.length ? `${queue.length} song${queue.length > 1 ? 's' : ''} waiting in the queue.` : 'Search on the right, then hit + to add it to the queue. The first song starts straight away.'}</p>
        {queue.length > 0 && (
          <button className="btn sun shadow" onClick={toggle}>
            Start the queue
          </button>
        )}
      </div>
    </div>
  )
}

/** The lyrics + controls card. `focus` fills the window. */
export function SingPanel({ focus }: { focus: boolean }) {
  const current = usePlayer((s) => s.current)
  const cues = usePlayer((s) => s.cues)
  const transpose = usePlayer((s) => s.transpose)
  const vocal = usePlayer((s) => s.vocalLevel)
  const queue = usePlayer((s) => s.queue)
  const setFocus = useUi((s) => s.setFocus)
  const theme = useFocusTheme()
  const [idle, setIdle] = useState(false)

  // in focus mode, hide controls after 3 s without mouse movement
  useEffect(() => {
    if (!focus) {
      setIdle(false)
      return
    }
    let t = window.setTimeout(() => setIdle(true), 3000)
    const move = (): void => {
      setIdle(false)
      clearTimeout(t)
      t = window.setTimeout(() => setIdle(true), 3000)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', move)
    return () => {
      clearTimeout(t)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', move)
    }
  }, [focus])

  const next = queue[0]
  return (
    <section
      className={`sing-panel ${focus && current?.hasVideo ? 'has-video' : ''}`}
      data-theme={focus ? theme : undefined}
      aria-label="Now singing"
      style={{ cursor: focus && idle ? 'none' : undefined }}
    >
      {focus && current?.hasVideo && <VideoBackground key={current.id} song={current} />}
      <Decorations focus={focus} theme={theme} video={!!current?.hasVideo} />
      <div className="sp-head">
        {current && <Cover song={current} />}
        {current ? (
          <div className="sp-titles">
            <span className="now">Now singing</span>
            <span className="t">{current.title}</span>
            <span className="a">{current.artist}</span>
          </div>
        ) : (
          <div className="sp-titles">
            <span className="now">Karaokay</span>
          </div>
        )}
        {current && !focus && (
          <div className="sp-chips">
            {current.key && (
              <span className="pill sun">
                {keyName(current.key, transpose)} · {formatTranspose(transpose)}
              </span>
            )}
            {current.hasVocals && <span className="pill mint">Guide vocal {Math.round(vocal * 100)}%</span>}
          </div>
        )}
        <span className="grow" />
        {focus && next && (
          <div className="upnext-card">
            <Cover song={next.song} />
            <div style={{ minWidth: 0 }}>
              <div className="l">Up next</div>
              <div className="t">{next.song.title}</div>
              <div className="a">{next.song.artist}</div>
            </div>
          </div>
        )}
        {focus && current && <ThemeMenu />}
        <button className="btn shadow" onClick={() => setFocus(!focus)} title="Focus mode  L">
          {focus ? <IconCollapse /> : <IconExpand />}
          {focus ? 'Exit focus' : 'Focus'}
          {focus && <kbd>Esc</kbd>}
        </button>
      </div>

      {current ? <LyricLines song={current} cues={cues} transpose={transpose} /> : <IdleStage />}

      <div className={`controls ${focus && idle ? 'hidden' : ''}`}>
        <Transport />
        <SeekBar />
        <KeyControl compact={focus} />
        {focus ? (
          <>
            <LyricSync />
            <VocalSlider inline />
          </>
        ) : (
          <>
            <VocalSlider />
            <VolumeSlider />
          </>
        )}
      </div>
      {focus && queue.length > 1 && (
        <div className={`queue-peek ${idle ? 'hidden' : ''}`}>
          <span className="label" style={{ color: 'var(--sun)' }}>
            Then
          </span>
          {queue.slice(1, 4).map((q) => (
            <span key={q.id} className="pill">
              {q.song.title}
              {q.transpose !== null && q.transpose !== 0 ? ` · ${formatTranspose(q.transpose)}` : ''}
            </span>
          ))}
          {queue.length > 4 && <span>+{queue.length - 4} more</span>}
        </div>
      )}
      <Interstitial />
    </section>
  )
}

/** Compact lyrics strip shown above browse views. */
export function LyricsStrip() {
  const current = usePlayer((s) => s.current)
  const cues = usePlayer((s) => s.cues)
  const transpose = usePlayer((s) => s.transpose)
  const duration = usePlayer((s) => s.duration)
  const setView = useUi((s) => s.setView)
  const { shape, sweepRef } = useLyricFrame(cues, current?.lyricsOffsetMs ?? 0)
  const pos = usePosition(2)
  const pct = duration > 0 ? (pos / duration) * 100 : 0
  if (!current) return null
  const cur = shape.cur >= 0 ? cues[shape.cur] : null
  return (
    <section className="lyrics-strip" aria-label="Lyrics">
      <img className="sticker" src={star} alt="" style={{ right: 260, top: -18, width: 56, transform: 'rotate(18deg)' }} />
      <Cover song={current} />
      <div className="mid">
        <span className="meta">
          {current.title} · {current.artist}
          {current.key ? ` · ${keyShort(current.key, transpose)}${transpose ? ` (${formatTranspose(transpose)})` : ''}` : ''}
        </span>
        {cur ? (
          <p key={shape.cur} ref={sweepRef} className={`lyric-current ${shape.done ? 'done' : ''}`}>
            <span className="sweep">{cur.text.replace(/\n/g, ' ')}</span>
          </p>
        ) : (
          <p className="lyric-current" style={{ ['--p' as string]: '0%' }}>
            <span className="sweep">{cues.length === 0 ? current.title : '♪'}</span>
          </p>
        )}
        <p className="lyric-next">{shape.next ? shape.next.text.replace(/\n/g, ' ') : ' '}</p>
      </div>
      <div className="side">
        <Transport big={false} />
        <button className="btn" onClick={() => setView('sing')}>
          Back to Sing
        </button>
      </div>
      <div className="progress" style={{ width: `${pct}%` }} />
    </section>
  )
}
