import { useState } from 'react'
import { api } from '../api'
import { usePlayer } from '../stores/player'
import { useUi } from '../stores/ui'
import { useLibrary } from '../stores/library'
import { Slider } from '../components/common'
import { Swatch } from '../components/SingPanel'
import { THEMES } from '../../shared/themes'

export function SettingsView() {
  const settings = usePlayer((s) => s.settings)
  const update = usePlayer((s) => s.updateSetting)
  const toast = useUi((s) => s.toast)
  const count = useLibrary((s) => s.count)
  const [busy, setBusy] = useState(false)
  if (!settings) return null
  return (
    <div className="browse">
      <div className="browse-head">
        <h1>Settings</h1>
      </div>
      <div className="card settings">
        <div className="row">
          <span className="label">Library folder</span>
          <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
            <span className="path" style={{ flex: 1 }} title={settings.libraryRoot}>
              {settings.libraryRoot}
            </span>
            <button
              className="btn sm"
              onClick={async () => {
                const s = await api.invoke('settings:chooseLibraryFolder')
                if (s) {
                  usePlayer.setState({ settings: s })
                  toast('Library folder changed. Scanning…', 'info')
                }
              }}
            >
              Change…
            </button>
            <button
              className="btn sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await api.invoke('library:rescan')
                setBusy(false)
                toast('Library rescanned', 'ok', 2000)
              }}
            >
              {busy ? 'Scanning…' : 'Rescan'}
            </button>
          </div>
          <span className="hint">{count ?? 0} songs. One folder per song; you can edit it in Finder and the app picks up changes.</span>
        </div>
        <div className="row">
          <span className="label">When importing</span>
          <div className="seg" role="group" aria-label="Import mode">
            <button className={settings.importMode === 'copy' ? 'on' : ''} onClick={() => void update('importMode', 'copy')}>
              Copy files
            </button>
            <button className={settings.importMode === 'move' ? 'on' : ''} onClick={() => void update('importMode', 'move')}>
              Move files
            </button>
          </div>
        </div>
        <div className="row">
          <span className="label">Default guide vocal</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Slider
              label="Default guide vocal level"
              value={settings.defaultGuideVocal}
              onChange={(v) => usePlayer.setState({ settings: { ...settings, defaultGuideVocal: v } })}
              onCommit={(v) => void update('defaultGuideVocal', Math.round(v * 100) / 100)}
              color="var(--mint)"
              className="grow"
            />
            <span className="num" style={{ width: 44 }}>
              {Math.round(settings.defaultGuideVocal * 100)}%
            </span>
          </div>
          <span className="hint">Used for songs where you haven’t set a level yet.</span>
        </div>
        <div className="row">
          <span className="label">Next-up screen</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Slider
              label="Seconds between songs"
              value={settings.interstitialSeconds}
              max={30}
              step={1}
              onChange={(v) => usePlayer.setState({ settings: { ...settings, interstitialSeconds: Math.round(v) } })}
              onCommit={(v) => void update('interstitialSeconds', Math.round(v))}
              color="var(--pink)"
            />
            <span className="num" style={{ width: 44 }}>
              {settings.interstitialSeconds}s
            </span>
          </div>
          <span className="hint">How long “Up next” shows between songs. 0 starts the next song straight away.</span>
        </div>
        <div className="row">
          <span className="label">Focus theme</span>
          <div className="theme-cards" role="radiogroup" aria-label="Default focus theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={settings.focusTheme === t.id} className={`theme-card ${settings.focusTheme === t.id ? 'on' : ''}`} onClick={() => void update('focusTheme', t.id)}>
                <Swatch id={t.id} />
                <span>
                  {t.name}
                  <small style={{ display: 'block' }}>{t.blurb}</small>
                </span>
              </button>
            ))}
          </div>
          <span className="hint">The look of focus mode. Each song can pick its own in Song details or from the Theme button in focus mode.</span>
        </div>
        <div className="row">
          <span className="label">Focus on play</span>
          <div className="seg" role="group" aria-label="Focus mode when a song starts">
            <button className={settings.focusOnPlay ? 'on' : ''} onClick={() => void update('focusOnPlay', true)}>
              On
            </button>
            <button className={!settings.focusOnPlay ? 'on' : ''} onClick={() => void update('focusOnPlay', false)}>
              Off
            </button>
          </div>
          <span className="hint">Switch to big lyrics whenever a song starts.</span>
        </div>
      </div>
    </div>
  )
}
