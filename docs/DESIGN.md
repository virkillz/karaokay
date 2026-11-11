# Karaokay — Design Document

Version 1.2 · 2026-11-11 · Status: **v1 implemented** (M0–M6). See section 17 for what the build changed or measured.

This document is the complete handover for building Karaokay. A new Claude Code session should be able to build the app from this file plus the mockup in `docs/mockup/`. Section 16 lists what to do first.

---

## 1. Product summary

Karaokay is a personal karaoke player that runs locally on one laptop (macOS first; nothing in the design blocks Windows/Linux). It plays the owner's own karaoke files, shows synced lyrics, and lets the singer change the key.

**Decisions confirmed with the owner**

| Topic | Decision |
|---|---|
| Platform | Electron + React desktop app |
| File organisation | Files are not organised yet. The app defines a one-folder-per-song convention and an import flow that files songs into it. |
| Lyrics display | Classic two-line karaoke: current line highlighted with a progress sweep, next line dimmed |
| Screens | **One screen only.** Lyrics live in the main window next to the library and queue. There is no second-screen / external-display output, now or later. |
| Visual style | Bright, playful "candy pop": light background, chunky navy outlines, hard offset shadows, rounded display type, sticker-style mascot art |
| Audio formats | MP3, WAV, FLAC |
| Song shapes | (a) instrumental only, or (b) instrumental + separate vocal file |
| Lyrics format | SRT |
| Key | Detect the key automatically; transpose in semitones during playback |

**Assumptions made by the designer (the owner did not choose; change freely)**

- A *guide vocal* volume slider (0–100 %) is in scope, because the separate vocal file is already being played in sync and a slider costs almost nothing over an on/off switch.
- Tempo control and microphone input are **out of scope for v1** (see section 14). The architecture notes say where they would attach.
- Single user, no accounts, no network access at all. No telemetry.

## 2. Goals and non-goals

**Goals**

1. Find a song in under five seconds by typing part of the title, artist or genre.
2. Build and manage a queue while a song is playing, without interrupting it.
3. Lyrics that are readable from across a room and visibly in time with the music.
4. Change key during playback with no tempo change, no audible gap, and instrumental and vocal staying in perfect sync.
5. Look like a commercial product: dark, calm, high contrast, no clutter.

**Non-goals**

- No streaming, downloading, or online catalogue.
- No vocal removal / stem separation. The user supplies instrumentals.
- No lyric authoring or SRT editor (only a global sync offset per song).
- No scoring, no pitch tracking of the singer.

## 3. Feature list (v1)

| # | Feature | Notes |
|---|---|---|
| F1 | Library folder with one folder per song | Section 5 |
| F2 | Import by drag-and-drop or file picker, with automatic grouping of instrumental / vocal / SRT | Section 6 |
| F3 | Instant search across title, artist, album, genre, and lyric text | Section 7 |
| F4 | Browse by Songs, Artists, Genres, Favorites, History | |
| F5 | Filters: genre chips, "has guide vocal", "has lyrics"; sort by title, artist, recently added, most played | |
| F6 | Queue: add to end, play next, reorder by drag, remove, clear, skip, restart, auto-advance | Section 8 |
| F7 | Saved playlists: save queue as playlist, add songs to a playlist, load playlist into queue | |
| F8 | Playback of instrumental, plus guide vocal with its own volume | Section 9 |
| F9 | Key detection on import, shown in the library; manual override | Section 10 |
| F10 | Transpose −6…+6 semitones live, remembered per song ("my key") | Section 9, 10 |
| F11 | Sing panel: two-line lyrics with sweep, countdown dots, title card and next-up card, always visible in the main window; Focus mode enlarges it in the same window | Section 11 |
| F12 | Per-song lyric sync offset | |
| F13 | Keyboard shortcuts for everything used mid-song | Section 12.4 |
| F14 | Song details editing (metadata, key override) | Saved to `song.json`, never to the audio file |

## 4. Technology

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron (current stable) | Confirmed by owner |
| Build | `electron-vite` + TypeScript (strict) | One config for main, preload, renderer; HMR |
| UI | React 18+, function components | |
| Styling | One plain stylesheet (`src/renderer/styles.css`) with the tokens in section 12.1 as CSS variables | Matches the mockup's class structure directly; Tailwind was not needed |
| State | Zustand (one store per domain: library, queue, player, ui) | Small, no boilerplate, works outside React for the audio engine |
| Long lists | `@tanstack/react-virtual` | Library may reach thousands of rows |
| Drag reorder | `@dnd-kit/sortable` | Queue and playlist ordering |
| Database | SQLite through `better-sqlite3`, with FTS5 | Synchronous, fast, full-text search built in. Needs `@electron/rebuild` in `postinstall`. |
| Tag reading | `music-metadata` (main process) | Reads ID3, Vorbis comments, WAV info, embedded cover art |
| File watching | `chokidar` on the library root | Picks up manual changes in Finder |
| Pitch shifting | **Signalsmith Stretch** (`signalsmith-stretch` on npm, MIT, WASM + AudioWorklet) | High quality, pitch and time independent, multi-channel, real-time parameter changes |
| Key detection | `essentia.js` (WASM) in a Web Worker | Proven key extractor. AGPL licence is acceptable for a personal, non-distributed app. Fallback in section 10. |
| Packaging | `electron-builder`, unsigned `.dmg` for personal use | |
| Tests | Vitest for unit tests; Playwright (Electron mode) for a handful of smoke tests | |

> **Verified in M0.** Both libraries behave as described; measurements are in section 17.

## 5. Library on disk

The library is a normal folder the user can open, back up, and edit by hand. The database is only a cache of it and can be rebuilt at any time.

Default root: `~/Music/Karaokay` (changeable in Settings).

```
~/Music/Karaokay/
  Nora Vale - After Midnight, Before You/
    instrumental.flac        required   exactly one: instrumental.{mp3,wav,flac}
    vocals.flac              optional   vocals.{mp3,wav,flac}
    lyrics.srt               optional
    cover.jpg                optional   cover.{jpg,png}
    song.json                written by the app
  Kilo Static - Neon Midnight/
    instrumental.mp3
    vocals.mp3
    song.json
```

Rules

- A folder is a song if it contains `instrumental.*` in a supported format. Other folders are ignored. Nesting is allowed one level deep (`Genre/Artist - Title/`) so users can group by hand, but the app always imports flat.
- Folder name is `Artist - Title`, sanitised for the filesystem. It is for humans only; the app never parses identity from it after import.
- `vocals.*` must be the isolated vocal of the same recording, starting at the same instant as the instrumental. A `vocalOffsetMs` field covers files that are not aligned.

### 5.1 `song.json`

```json
{
  "schema": 1,
  "id": "0d2f6c1e-6c1b-4a8e-9d7b-0a4f6e1c2b3a",
  "title": "After Midnight, Before You",
  "artist": "Nora Vale",
  "album": null,
  "genre": "Ballad",
  "year": 2019,
  "language": "en",
  "key": { "tonic": 6, "mode": "minor", "source": "detected", "confidence": 0.86 },
  "bpm": null,
  "transpose": -2,
  "lyricsOffsetMs": 0,
  "vocalOffsetMs": 0,
  "guideVocalLevel": null,
  "addedAt": "2026-11-11T09:30:00Z"
}
```

- `id` is a UUID created at import. Playlists, history and favourites reference it, so renaming or moving a folder never breaks them.
- `key.tonic` is a pitch class 0–11 (C = 0). `key.source` is `"detected"` or `"manual"`; a manual key is never overwritten by re-analysis.
- `transpose` is the singer's preferred shift for this song ("my key"). `guideVocalLevel` is `null` (use the global default) or 0–1.
- Metadata precedence when a folder has no `song.json` (added by hand): audio tags of the instrumental, then the folder name split on the first `" - "`, then `Unknown Artist` / folder name. The app then writes a `song.json`.
- Favourites, play counts, history, playlists and the queue live in the database only (they are about the user, not the song).

## 6. Import flow

Entry points: the **Import songs** button, dropping files or folders anywhere on the window, and `File → Import…`.

1. **Collect.** Walk dropped folders recursively; keep `.mp3 .wav .flac .srt .jpg .png`.
2. **Group into candidate songs.** Normalise each filename (lower-case, strip extension, strip role markers, collapse punctuation and whitespace) and group files whose normalised names match. Files that share a folder with exactly one audio pair also group together.
   - Vocal markers: `vocal`, `vocals`, `vox`, `acapella`, `a cappella`, `lead`.
   - Instrumental markers: `instrumental`, `inst`, `karaoke`, `backing`, `minus one`, `off vocal`, `no vocals`.
   - One unmarked audio file in a group is the instrumental. Two audio files where only one is marked: the other takes the remaining role.
3. **Read metadata** from the instrumental's tags; fall back to `Artist - Title` filename parsing.
4. **Review dialog** (mockup screen 3, left). One card per song showing the three roles with a *change/choose* link each, an editable title and artist, and a status: *Ready*, *No lyrics file* (allowed), or *Needs instrumental* (blocks that card). Duplicates (same normalised artist + title already in the library) are flagged with *Replace / Keep both / Skip*.
5. **Commit.** Copy (default) or move files into the library folder under the standard names, write `song.json`, insert into the database, and enqueue key analysis. Progress is shown in a small toast; the app stays usable.

SRT files are transcoded to UTF-8 on import (detect encoding with `chardet`/`jschardet`, decode with `iconv-lite`).

## 7. Database and search

File: `app.getPath('userData')/karaokay.db`. Migrations are numbered SQL files applied at start-up using `PRAGMA user_version`.

```sql
CREATE TABLE songs (
  id               TEXT PRIMARY KEY,          -- song.json id
  folder           TEXT NOT NULL UNIQUE,      -- path relative to library root
  title            TEXT NOT NULL,
  artist           TEXT NOT NULL,
  album            TEXT,
  genre            TEXT,
  year             INTEGER,
  language         TEXT,
  duration_ms      INTEGER NOT NULL,
  instrumental     TEXT NOT NULL,             -- file name inside folder
  vocals           TEXT,
  lyrics           TEXT,
  cover            TEXT,
  key_tonic        INTEGER,                   -- 0..11, NULL until analysed
  key_mode         TEXT,                      -- 'major' | 'minor'
  key_source       TEXT,                      -- 'detected' | 'manual'
  key_confidence   REAL,
  analysis_status  TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
  transpose        INTEGER NOT NULL DEFAULT 0,
  lyrics_offset_ms INTEGER NOT NULL DEFAULT 0,
  vocal_offset_ms  INTEGER NOT NULL DEFAULT 0,
  guide_vocal_level REAL,
  favorite         INTEGER NOT NULL DEFAULT 0,
  play_count       INTEGER NOT NULL DEFAULT 0,
  last_played_at   TEXT,
  added_at         TEXT NOT NULL,
  scan_signature   TEXT NOT NULL              -- size+mtime of files, to skip unchanged folders on rescan
);

CREATE VIRTUAL TABLE songs_fts USING fts5(
  title, artist, album, genre, lyrics_text,
  content='', tokenize="unicode61 remove_diacritics 2", prefix='1 2 3'
);                                            -- rowid mapped to songs.rowid; maintained in code

CREATE TABLE playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT, updated_at TEXT);
CREATE TABLE playlist_items (playlist_id TEXT, position INTEGER, song_id TEXT, PRIMARY KEY (playlist_id, position));
CREATE TABLE queue_items (id TEXT PRIMARY KEY, position INTEGER NOT NULL, song_id TEXT NOT NULL, transpose INTEGER);
CREATE TABLE history (id INTEGER PRIMARY KEY, song_id TEXT NOT NULL, played_at TEXT NOT NULL, transpose INTEGER);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);   -- JSON values
```

**Search behaviour**

- One search box. Each whitespace-separated term becomes a prefix query, all terms must match (`mid car` → `mid* AND car*`).
- Ranking: `bm25(songs_fts, 10, 8, 2, 4, 1)` so title and artist hits beat lyric hits.
- Runs on every keystroke with a 60 ms debounce; a query takes well under 10 ms at this scale.
- Matching terms are highlighted in title and artist (amber, see mockup). A song matched only through its lyrics shows a one-line lyric snippet under the title.
- `⌘K` or `/` focuses search from anywhere. `Enter` adds the highlighted row to the queue, `⇧Enter` plays it next, `⌘Enter` plays it now. Arrow keys move the highlight.
- Filters combine with search using AND.

**Scanning.** On start-up and on watcher events, compare each song folder's `scan_signature`; only changed folders are re-read. A song whose folder has gone missing is marked unavailable (greyed out, skipped by the queue) rather than deleted, so playlists survive an unplugged drive.

## 8. Queue and playlists

- The queue is an ordered list of items; the same song may appear more than once. Each item can carry its own `transpose` (shown as `+1` / `−3` in the mockup), otherwise the song's saved value applies.
- Actions: *Add to queue* (end), *Play next* (position 0), *Play now* (replace current, current song is dropped), drag to reorder, remove, clear.
- **Skip** ends the current song with a 300 ms fade and starts the next. **Restart** seeks to 0. There is no "previous song"; History is one click away for that.
- When a song ends: record history, increment play count, then show the *next-up interstitial* in the Sing panel for 8 seconds (configurable 0–30 s) — title, artist, key — with *Start now* and *Pause queue*. Empty queue → idle screen.
- The queue is persisted on every change and restored on launch (paused, at the start of the first item).
- Playlists are named, ordered song lists. *Save as playlist* snapshots the queue. A playlist can be *Queued* (appended) or *Played* (replaces the queue). Songs are added to playlists from the row context menu.

## 9. Audio engine

All audio runs in the renderer with the Web Audio API. Chromium decodes MP3, WAV and FLAC natively.

### 9.1 Signal graph

```
instrumental AudioBuffer ─┐
                          ├─► Stretch node (4 ch: 0-1 inst, 2-3 vocal) ─► ChannelSplitter
vocal AudioBuffer ────────┘                                                │
                                         ch 0,1 ─► Merger ─► instGain ─────┤
                                         ch 2,3 ─► Merger ─► vocalGain ────┼─► masterGain ─► limiter ─► destination
```

- **One** stretch node processes instrumental and vocal together as four channels, so both receive identical processing and cannot drift. If the library turns out not to support four channels cleanly, fall back to two stretch nodes that always receive the same `schedule()` call in the same task; the spike must then measure drift over five minutes (target: under 5 ms).
- `limiter` is a `DynamicsCompressorNode` set as a safety limiter (threshold −1 dB, ratio 20), since adding a vocal to an instrumental can clip.
- Instrumental-only songs feed silence on channels 2–3 and hide the guide-vocal slider.

### 9.2 Loading

1. Main process exposes library files through a custom protocol, `karaokay-media://<songId>/<role>`, registered with `protocol.handle` and resolved through the database (never from a raw path supplied by the renderer).
2. Renderer fetches both files, calls `decodeAudioData` (which also resamples to the context rate, so a 44.1 kHz instrumental and a 48 kHz vocal line up), pads the shorter one with silence, applies `vocalOffsetMs`, and hands the channel data to the stretch node.
3. Decoding a five-minute FLAC takes about one to three seconds; the player shows a loading state. The **next** queue item is decoded in the background once the current song has 30 s left, so song changes are immediate. Keep at most two songs decoded (roughly 230 MB each for two five-minute stereo files at 48 kHz float).

### 9.3 Engine interface

```ts
interface AudioEngine {
  load(song: SongRef): Promise<void>;         // decode + prepare, stays paused
  preload(song: SongRef): Promise<void>;      // decode only
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setTranspose(semitones: number): void;      // -6..+6, applied live
  setGuideVocalLevel(level: number): void;    // 0..1
  setVolume(level: number): void;             // 0..1
  readonly position: number;                  // seconds of song being heard right now
  readonly duration: number;
  readonly state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended';
  on(event: 'state' | 'ended' | 'error', cb: (...a: any[]) => void): () => void;
}
```

- The engine is a plain TypeScript class outside React. The player store subscribes to it; components read the store.
- `position` is derived from the stretch node's reported input time minus its output latency, so lyrics follow what is *heard*. UI polls it in a `requestAnimationFrame` loop (lyrics) and at 4 Hz (seek bar text).
- Expected Signalsmith usage (confirm in the spike): `const node = await SignalsmithStretch(ctx, {outputChannelCount: [4]})`, `node.addBuffers(channels)`, `node.schedule({ active, input, semitones, rate })`, `node.inputTime`, `node.latency()`.
- Transposing by 0 should bypass pitch processing if the library allows it; otherwise it is acceptable to stay in the stretch path.
- Gain changes use `setTargetAtTime` with a 15 ms time constant to avoid clicks.
- Transposition changes pitch only; tempo and therefore SRT timings are unaffected.

## 10. Key detection and transposition

**Detection** runs once per song after import, in a background queue (one song at a time, paused while a song is loading).

1. Decode the instrumental (plus vocal, summed at −6 dB, when present — the melody helps the estimate).
2. Mix to mono and resample to 16 kHz with an `OfflineAudioContext`. Analyse the middle 120 seconds if the track is longer than that.
3. Post the `Float32Array` to a Web Worker running essentia.js `KeyExtractor` (profile `edma` or `bgate`; choose in the spike by testing on the owner's files). Result: tonic, scale, strength.
4. Store in the database and `song.json` with `source: "detected"`. Strength below 0.5 is shown with a `?` after the key.

*Fallback if essentia.js is impractical:* compute a 12-bin chromagram (FFT 4096, hop 2048, 55–2000 Hz, summed over the excerpt) and correlate against the 24 rotated Krumhansl-Kessler key profiles; the best correlation is the key, and the margin over the second-best gives confidence. About 100 lines, no dependency, somewhat less accurate.

**Detection is an estimate.** Relative major/minor confusions (C major vs A minor) are common in every algorithm. That is why the key is editable in Song details and why a manual key is never overwritten.

**Display and transposition**

- Key names use one fixed spelling per pitch class. Major: C, D♭, D, E♭, E, F, F♯, G, A♭, A, B♭, B. Minor: C, C♯, D, E♭, E, F, F♯, G, G♯, A, B♭, B.
- Current key = `(tonic + transpose) mod 12`, same mode. The player shows the current key large and `orig. A♭ · +2` beneath it (see mockup).
- Range −6…+6 semitones; quality degrades beyond that. `[` and `]` step down and up, `\` resets to 0.
- Changing transpose during a song saves it as that song's "my key" (written to `song.json` after a 2 s debounce), unless the queue item carries its own override.
- The library *Key* column shows the original key, so it can be sorted and scanned.

## 11. Lyrics

### 11.1 SRT parsing

Input is UTF-8 (converted at import). Parser requirements:

- Strip BOM; accept `\r\n` and `\n`; tolerate missing index lines and extra blank lines.
- Timestamps `HH:MM:SS,mmm --> HH:MM:SS,mmm`; accept `.` as the millisecond separator.
- Strip markup (`<i>`, `<b>`, `<font …>`, `{\an8}`).
- A cue with several text lines is one lyric line group; lines are joined with a soft break and wrapped by the renderer.
- Sort cues by start time; clamp overlapping cues so each ends no later than the next begins.
- Output: `Cue[] = { start: number; end: number; text: string }` in seconds. Pure function, unit-tested with fixture files.

Lyric text is also stored in `songs_fts.lyrics_text` for search.

### 11.2 Sing panel (lyrics in the main window)

There is one window on one screen. Lyrics are never in a separate window; they occupy the **Sing panel**, which is part of the main layout in all three window modes (section 12.2):

| Mode | Sing panel | Rest of the window |
|---|---|---|
| **Sing** (default) | Large card on the left, about 60 % of the width, full height | Search, results and queue on the right |
| **Focus** (`L`) | Fills the window; lyrics at their largest | Queue shrinks to a peek strip of the next two songs along the bottom; search opens as an overlay with `⌘K` |
| **Browse** (Artists, Genres, Playlists, Settings) | Collapses to a 120 px lyrics strip across the top showing the current line with its sweep, next line, and transport | Full-width browsing below |

The panel's lyric renderer is one component that takes its size from its container, so the same timing code drives all three modes.

Behaviour, driven by `t = engine.position − lyricsOffsetMs / 1000` (a positive offset shows lyrics later):

| Situation | Display |
|---|---|
| Before the first cue | Title card: song title, artist, key. Fades out 4 s before the first cue. |
| Inside a cue | Current line large, left-aligned, with the sweep. Next line smaller, dimmed, right-aligned beneath. |
| Sweep | Fill fraction = `(t − start) / (end − start)`, applied across the text width with a clipped gradient. SRT has no per-word timing, so the sweep is linear across the line; it is a guide, not word-accurate. |
| Between cues, gap < 4 s | Finished line fades to 30 %; the next line is promoted when its cue starts. |
| Gap ≥ 4 s (intro, solo) | Upcoming line shown dimmed with four countdown dots that light one per second over the last 4 s. |
| Gap ≥ 15 s | A small `♪` and a thin progress bar for the break; the upcoming line appears 6 s before its cue. |
| After the last cue | Lyrics fade; next-up interstitial appears when the audio ends. |
| No SRT | Title card stays, with "No lyrics for this song". |

- Line promotion animates (next line slides up and grows, 180 ms) so the eye is never lost.
- Type: Fredoka 700, current line sized with `clamp()` against the panel width so the longest cue in the song fits on at most two lines; next line at 60 % of that.
- Panel header: cover, title, artist, key chip. In Focus mode the next song in the queue is shown top-right.
- In Focus mode the control bar and cursor hide after 3 s without mouse movement and return on movement. In Sing and Browse modes controls stay visible. Keyboard shortcuts always work.
- `F` toggles real fullscreen of the same window (any mode). `Esc` leaves fullscreen first, then Focus mode.
- **Lyric sync** `−` / `+` shifts by 50 ms per step (`,` and `.` keys), saved per song.

## 12. User interface

**Visual reference:** the Design canvas at https://claude.ai/artifact/E3RtgsK5c7hksEwU2oZifT (private to the owner) with four artboards: Sing mode, Focus mode, Browse mode with lyrics strip, Empty library + Import. The same artboard sources are in `docs/mockup/canvas/project/*.dc.html` (HTML with inline styles; read them for exact sizes and colours). Art assets are in `docs/mockup/art/` and are regenerated with `tools/art/gen.sh` (section 12.5). Song names, artists and lyrics in the mockup are invented.

### 12.1 Design tokens — "candy pop"

Light, bright and playful. Everything sits on a bubblegum background; panels are white or coloured slabs with a thick navy outline and a hard, unblurred offset shadow, like stickers.

| Token | Value | Use |
|---|---|---|
| `--ground` | `#FFF0F6` | Window background |
| `--ink` | `#1C1646` | Text, all outlines, all hard shadows |
| `--ink-muted` | `#5E5689` | Secondary text (passes 4.5:1 on white and ground) |
| `--paper` | `#FFFFFF` | Search card, list rows, control bar, dialogs |
| `--stage` | `#3A1FA0` | Sing panel / lyrics strip background (grape) |
| `--stage-text-dim` | `#B9A9FF` | Next lyric line on stage |
| `--stage-text-meta` | `#DCD3FF` | Artist and meta text on stage |
| `--pink` | `#E0136B` | Primary buttons (white text), seek fill, wordmark accent |
| `--pink-soft` | `#FFE3EF` | Now-playing row, focus ring halo `#FFD0E4` |
| `--sun` | `#FFD23F` | Lyric sweep, key chip, active nav pill, play button, queue card (always with navy text) |
| `--mint` | `#19C3B0` | Guide-vocal colour, transpose chips, "Ready" states (`#B8F0E9` soft) |
| `--lilac` | `#EDE7FF` | Slider tracks, stepper buttons, key chips in lists |
| `--violet` | `#8B6CFF` | Volume fill |

Shape language:

- Outline `2–3 px solid var(--ink)` on every panel, button, chip, cover and slider.
- Shadow `4–8 px 4–8 px 0 var(--ink)` (no blur) on panels and primary buttons; pressed buttons translate by the shadow offset and drop it.
- Radii: panels 26–34 px, rows 16 px, buttons and chips fully round.
- A dragged queue row tilts −1.5° and gains a shadow; artist cards alternate tiny tilts (±1°).
- Lyrics: current line white with the sun-yellow sweep and a hard 4 px navy drop shadow; next line `--stage-text-dim`.
- Search matches use a sun-yellow highlighter mark behind the text.
- Decoration: sticker art (disco ball, star, note, heart) and small confetti dots placed on the stage only around the lyrics, never over them; all `aria-hidden`.

Fonts (bundle locally with `@fontsource`, no network): **Fredoka** 600/700 for display (wordmark, titles, lyrics, key read-outs), **Nunito** 700/800/900 for UI text. Base size 14 px. Tabular numerals for times. Colour rule: pink means *action*, sun means *music information* (key, sweep, matches) or *current selection*, mint means *vocal / transpose / OK*.

Light theme only.

### 12.2 Window layout

One window on one screen. No sidebar; navigation is a pill bar in the header.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ (mic) karaokay   [Sing|Artists|Genres|Playlists|Favorites|History]  [Import] (⚙) │
├───────────────────────────────────────────────┬──────────────────────────┤
│ SING PANEL (grape, ~60 %)                     │ SEARCH CARD (white)       │
│  cover · title · artist · key chip · [Focus]  │  [ search … ⌘K ]          │
│                                               │  genre / filter chips      │
│  ● ● ○ ○                                      │  results: cover, title,    │
│  Round and round the lights go by             │  artist·genre·time, key,   │
│                    and I'm still holding on…  │  [play next] [+ queue]     │
│                                               ├──────────────────────────┤
│ ┌ controls ────────────────────────────────┐ │ UP NEXT (sun-yellow card) │
│ │ ⏮ ⏯ ⏭  1:32 ━━━●──── 3:48  Key − B♭ + │ │  ⋮⋮ cover title  −3  4:02  │
│ │ guide vocal ━●──  volume ━━━━●─        │ │  [Save as playlist][Clear] │
│ └──────────────────────────────────────────┘ │                            │
└───────────────────────────────────────────────┴──────────────────────────┘
```

- **Sing mode** (above) is the default whenever the Sing tab is selected.
- **Focus mode** (`L` or the Focus button): the Sing panel fills the window; up-next card top-right, queue peek chips under the controls, lyric-sync stepper in the control bar.
- **Browse mode** (Artists, Genres, Playlists, Favorites, History, Settings): a 120 px lyrics strip with the current line, next line, pause/skip and time stays pinned under the header; the page content fills the rest.

Minimum window 1100 × 700. Below 1200 px the right column moves under the Sing panel. Use a hidden title bar with inset traffic lights on macOS (`titleBarStyle: 'hiddenInset'`); the header leaves room for them and is a drag region except for its controls.

### 12.3 Screens and states

| Screen | Content |
|---|---|
| **Search results (Sing mode)** | Rows: cover, title (match highlighted), `artist · genre · time`, key chip, *Play next*, *Add to queue* (pink +). Filter chips: genres, *Has vocal*, *Has lyrics*. Double-click adds to queue. Right-click: Play now, Play next, Add to queue, Add to playlist ▸, Favorite, Song details…, Show in Finder, Remove from library. The playing song's row is pink-soft. With an empty search box the card lists recently added songs. |
| **Artists** | Lyrics strip on top, then A–Z letter buttons and a grid of tinted artist cards (round photo from a song cover, name, song count, main genre); clicking one shows that artist's songs. |
| **Genres** | Same pattern as Artists. |
| **Favorites / History** | Song table; History is ordered by time and shows the key each song was sung in. |
| **Playlist** | Header (name, count, total time, *Play*, *Queue all*), then a reorderable song table. |
| **Sing panel / Focus** | Section 11.2. Focus is entered with the *Focus* button or `L`; optionally automatic when playback starts (setting, default off). |
| **Import dialog** | Section 6, artboard 4 right: sun-yellow header, one card per song with role pills (Instrumental sun, Vocal mint, Lyrics lilac) and Change/Choose buttons, status pill. |
| **Song details** | Dialog in the same style: metadata, original key with detected value, confidence and *re-analyse*, my key stepper, lyric sync offset, file list. |
| **Settings** | Library folder (change, rescan), import mode (copy / move), default guide-vocal level, interstitial seconds, Focus on play, output device. |
| **Empty library** | Artboard 4 left: dashed drop zone with the boombox sticker, "Drop your karaoke files here", *Choose files…*, and the folder convention in a yellow note. |
| **No results** | "No songs match ‘…’" with a *Clear filters* button. |
| **Missing files** | Row greyed with a warning icon; tooltip gives the expected path. |
| **Errors** | Non-blocking toast at the bottom left (decode failure, unreadable SRT). A song that fails to load is skipped after 3 s with a toast naming it. |

### 12.4 Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause (not while typing in a text field) |
| `⌘→` / `N` | Skip to next song |
| `⌘←` / `R` | Restart song |
| `←` / `→` | Seek −5 s / +5 s |
| `[` / `]` / `\` | Key down / up / reset |
| `V` | Toggle guide vocal between 0 and the last level |
| `↑` / `↓` (Focus) | Volume up / down |
| `,` / `.` | Lyrics earlier / later by 50 ms |
| `L` | Toggle Focus mode |
| `F` | Toggle fullscreen (same window) |
| `⌘K` or `/` | Focus search |
| `Enter` / `⇧Enter` / `⌘Enter` | Add highlighted song to queue / play next / play now |
| `⌘I` | Import |
| `Esc` | Leave fullscreen → leave Focus → clear search |

Media keys (play/pause, next) are wired through `navigator.mediaSession`.

### 12.5 Art assets

Sticker art and placeholder covers are generated with the `nanobanana` CLI (Gemini image model; needs `GEMINI_API_KEY`) and cut out with `remove-bg`, the same pipeline as the capytalism project (`~/Projects/node/capytalism/tools/art/gen.sh`).

- `tools/art/manifest.txt` — stickers, `id|prompt`; a shared style suffix (glossy cartoon sticker, thick navy outline, white background) is appended. Output: transparent 512 px WebP.
- `tools/art/covers.txt` — square placeholder covers (no text). Output: 320 px WebP.
- `tools/art/gen.sh [id …]` — generates missing (or named) assets into `docs/mockup/art/`; intermediate files go to `tools/out/` (git-ignored).
- To keep a character consistent across poses, pass the existing image as a reference: `nanobanana "<pose prompt>" --image tools/out/art/mascot/<file>.jpg`.

The app ships `mascot.webp` (logo, idle state), `mascot_cheer.webp` (queue card, end-of-queue celebration, import success), `boombox.webp` (empty library) and the disco / star / note / heart stickers (stage decoration). Placeholder covers are for the mockup only; in the app a song without `cover.*` gets a generated tile: a colour from the palette, chosen from a hash of the song id, with the title's first letter in Fredoka.

## 13. Application architecture

```
┌──────────────── main process (Node) ────────────────┐
│ window + menu        library/scanner.ts  (chokidar) │
│ protocol: karaokay-media://     library/importer.ts │
│ db/ (better-sqlite3, migrations, repositories)      │
│ ipc/ handlers                                       │
└───────────────────────┬─────────────────────────────┘
                        │ contextBridge (typed `window.api`)
┌───────────────────────┴──── renderer (Chromium) ────┐
│ React UI ── Zustand stores ── AudioEngine (Web Audio│
│                                + stretch worklet)   │
│ lyrics/ (srt parser, timeline)    analysis worker   │
│                                   (essentia.js)     │
└─────────────────────────────────────────────────────┘
```

Security settings: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict CSP with no remote origins, and navigation / new-window requests denied.

### 13.1 Project layout

```
karaokay/
  docs/DESIGN.md, docs/mockup/
  electron.vite.config.ts, package.json, tsconfig*.json
  src/
    shared/            types.ts (Song, QueueItem, Playlist, Key, Cue), keys.ts (naming + transpose maths), ipc.ts (channel contract)
    main/
      index.ts         app lifecycle, window, menu
      protocol.ts      karaokay-media:// handler
      db/              connection.ts, migrations/*.sql, songs.ts, playlists.ts, queue.ts, history.ts, settings.ts
      library/         scanner.ts, importer.ts, grouping.ts, songJson.ts, tags.ts
      ipc/             library.ts, queue.ts, playlists.ts, settings.ts
    preload/index.ts
    renderer/
      main.tsx, App.tsx, styles/tokens.css
      audio/           engine.ts, loader.ts
      analysis/        keyQueue.ts, key.worker.ts
      lyrics/          srt.ts, timeline.ts
      stores/          library.ts, queue.ts, player.ts, ui.ts
      components/      Header, NavPills, SearchCard, FilterChips, ResultList, QueueCard, ControlBar, KeyControl, Slider, LyricLines, Toasts
      views/           SingView (Sing + Focus modes), LyricsStrip, ArtistsView, GenresView, PlaylistView, FavoritesView, HistoryView, SettingsView
      dialogs/         ImportDialog, SongDetailsDialog
  tests/               unit/ (srt, grouping, keys, queue), fixtures/, e2e/
```

### 13.2 IPC contract (`window.api`)

All calls are `ipcRenderer.invoke`; events are pushed from main with `webContents.send`.

```ts
library: {
  search(q: { text?: string; genre?: string; artist?: string; hasVocals?: boolean; hasLyrics?: boolean;
              favorite?: boolean; sort?: SortKey; limit?: number; offset?: number }): Promise<{ songs: Song[]; total: number }>;
  get(id: string): Promise<Song>;
  artists(): Promise<{ name: string; count: number }[]>;
  genres(): Promise<{ name: string; count: number }[]>;
  update(id: string, patch: Partial<EditableSongFields>): Promise<Song>;   // also rewrites song.json
  setFavorite(id: string, on: boolean): Promise<void>;
  remove(id: string, opts: { deleteFiles: boolean }): Promise<void>;       // deleteFiles moves the folder to the Trash
  readLyrics(id: string): Promise<string | null>;                          // raw SRT text
  rescan(): Promise<void>;
  revealInFinder(id: string): Promise<void>;
  onChanged(cb: (e: { added: string[]; updated: string[]; removed: string[] }) => void): Unsubscribe;
}
importer: {
  pickFiles(): Promise<string[]>;
  analyse(paths: string[]): Promise<ImportCandidate[]>;      // grouping + metadata, nothing written
  commit(items: ImportCandidate[]): Promise<{ imported: string[]; failed: { name: string; reason: string }[] }>;
  onProgress(cb: (p: { done: number; total: number }) => void): Unsubscribe;
}
analysis: {
  pending(): Promise<string[]>;                              // song ids awaiting key detection
  saveKey(id: string, key: { tonic: number; mode: Mode; confidence: number }): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
}
queue:     { get, add(songId, where: 'end' | 'next'), move(itemId, toIndex), remove(itemId), clear(), shift(), setTranspose(itemId, n) }
playlists: { list, get(id), create(name, songIds?), rename, delete, addSongs, removeItem, moveItem }
history:   { list(limit), record(songId, transpose) }
settings:  { getAll(), set(key, value), chooseLibraryFolder() }
```

Dropped files reach the renderer as `File` objects; use `webUtils.getPathForFile` in preload to get their paths.

## 14. Out of scope for v1, and where each would attach

| Idea | Attachment point |
|---|---|
| Tempo control | The stretch node already supports a rate. Lyrics need no change because `position` is in song time. Add a control and a per-song field. |
| Microphone with reverb | `getUserMedia` → gain → convolver → `masterGain`. Latency through Web Audio makes this marginal; a hardware mixer is better. |
| Word-level lyric timing | Accept enhanced LRC or ASS `\k` tags alongside SRT; the `Cue` type gains optional `words[]` and the sweep uses them. |
| Singer names on queue items | Add `singer` to `queue_items`; show in the queue and interstitial. |
| Scoring | Out of scope. |

## 15. Implementation plan

Build in this order. Each milestone ends in something that runs and has its checks passing.

**M0 — Scaffold and audio spike (do this first; it removes the main technical risk)**
- `electron-vite` React + TypeScript project, Tailwind, tokens, lint, Vitest. `better-sqlite3` rebuilt for Electron and opening a database.
- A throwaway page that loads two hard-coded files and proves: synced four-channel playback through Signalsmith Stretch, live semitone changes, seek, pause, accurate `position`, and essentia.js returning a key from a worker.
- *Done when:* instrumental and vocal stay within 5 ms of each other after five minutes and three key changes; a key is printed for a test file; findings that differ from this document are written back into sections 4, 9 and 10.

**M1 — Library**
- Migrations, repositories, `song.json` read/write, scanner, watcher, `karaokay-media://`.
- Import grouping (pure function + tests), import dialog, empty state.
- App shell: header with nav pills, search card with filters and virtualised results, Artists and Genres views.
- *Done when:* dropping a mixed folder of files produces correct song folders, and search finds any of them by partial title, artist, or genre as you type.

**M2 — Playback and queue**
- `AudioEngine`, loader with preload, control bar (transport, seek, volume, guide vocal), media keys.
- Queue card with drag reorder, persistence, auto-advance, skip, restart.
- *Done when:* a five-song queue plays through unattended, can be reordered mid-song, and survives an app restart.

**M3 — Lyrics and Sing panel**
- SRT parser + tests, timeline state machine + tests (feed times, assert display state), Sing panel with sweep, countdown, title card, interstitial; Focus mode with auto-hiding controls; lyrics strip in Browse mode; fullscreen; sync offset.
- *Done when:* lyrics track the audio through seeks and pauses, and long instrumental gaps show the countdown.

**M4 — Key**
- Background analysis queue, key column, key control in the control bar, Focus mode and lyrics strip, per-song and per-queue-item transpose, Song details dialog with manual key.
- *Done when:* every imported song gets a key without blocking the UI, and transposing mid-song is click-free with lyrics unaffected.

**M5 — Playlists and finish**
- Playlists, favourites, history, settings, context menus, all shortcuts, toasts, missing-file handling.
- Visual pass against the mockup at 1440 × 900, 1100 × 700 and fullscreen.

**M6 — Package**
- `electron-builder` `.dmg`, app icon, verify a clean install on the owner's laptop with a real library.

### 15.1 Testing

| Layer | What |
|---|---|
| Unit (Vitest) | SRT parser (BOM, CRLF, tags, overlaps, bad timestamps), import grouping (name patterns in section 6), key naming and transpose maths, queue operations, lyric timeline states, search query builder |
| Integration | Scanner and importer against a temporary folder with tiny generated WAV files; database migrations from empty |
| E2E (Playwright + Electron) | Launch, import fixture songs, search, queue two, play, skip, enter Focus, switch to Artists and check the lyrics strip |
| Manual | Audio quality at ±1…±6 semitones, sync by ear and by recording, lyric readability at three metres |

Test fixtures must be generated (sine tones, short invented SRTs). Do not commit copyrighted audio or lyrics.

### 15.2 Risks

| Risk | Mitigation |
|---|---|
| Stretch library API or channel support differs from section 9 | M0 spike; two-node fallback; last resort `soundtouchjs` worklet (lower quality) |
| `better-sqlite3` native build problems | `@electron/rebuild` in `postinstall`; if it still fails, use Node's built-in `node:sqlite` when the Electron version ships it |
| Key detection wrong for some songs | Confidence indicator, manual override, never overwrite manual keys |
| Memory with long songs | Two-song decode cap; warn and decode on demand for files over 15 minutes |
| Vocal and instrumental files not aligned | `vocalOffsetMs` in `song.json`; later, a nudge control in Song details |
| SRT with unusual encoding or malformed cues | Encoding detection at import; tolerant parser; toast on failure and the song still plays |

## 16. Starting a new session

Suggested first prompt for the implementing session:

> Read `docs/DESIGN.md` and the mockup artboards in `docs/mockup/canvas/project/` (Main, Focus, Browse, Import `.dc.html`; art in `docs/mockup/art/`). Implement milestone M0 from section 15, verifying the Signalsmith Stretch and essentia.js APIs against their current documentation, and update the design document with anything that differs. Then stop and report before starting M1.

Things the implementing session will need from the owner:

- A few real song sets (instrumental, vocal, SRT) for the M0 spike and for judging key detection.
- Confirmation of the assumptions in section 1 (guide-vocal slider in; tempo and microphone out).

## 17. Implementation notes (v1 build, 2026-11-11)

**How to run** — see `README.md`. `npm run dev` for development, `npm run dist` for `dist/Karaokay-<version>-arm64.dmg` (unsigned; right-click › Open the first time).

**M0 measurements** (in-app self-test, `src/renderer/dev/selftest.ts`, run against generated click tracks)

| Check | Result |
|---|---|
| Instrumental vs vocal drift through two live key changes | **0 samples** on every click: one 4-channel Signalsmith node keeps them locked |
| Stretch node position vs audio | node reports input time **~120 ms ahead** of its output. The engine subtracts this plus `AudioContext.outputLatency` (56 ms on the dev MacBook) |
| Lyric position error after compensation | mean −0.4 ms, all within ±2.2 ms |
| Key detection (essentia.js `KeyExtractor`, EDMA profile, 16 kHz mono, middle 120 s) | ~100 ms per song in a Web Worker. Major songs correct; the two synthetic minor songs came back as their relative major, as predicted in section 10 |
| SQLite FTS5 | prefix search, bm25 ranking and lyric snippets work in Electron 45 |

**Decisions made during the build**

- Signalsmith's worklet is loaded from a `blob:` URL, so the renderer CSP allows `blob:` for scripts and workers, and `'wasm-unsafe-eval'` for both WASM libraries.
- Electron 45 / Node 24, electron-vite 6 (Vite 8), React 19, better-sqlite3 13. Main process is ESM; the sandboxed preload is built as CommonJS (`out/preload/index.cjs`).
- Database migrations are inline SQL strings in `src/main/db/connection.ts` instead of separate `.sql` files.
- **Add to queue when nothing is playing starts that song immediately.** Otherwise songs wait in the queue.
- History is recorded once a song has played 30 s or reached its end; skipping earlier does not count.
- Changing key, guide vocal level or lyric sync during a song saves it to that song (`song.json`) after a short debounce. The −/+ buttons on a queue row set a key for that turn only.
- Focus mode `⌘K` opens search as an overlay; elsewhere `⌘K` jumps to the Sing view's search box.
- "Remove from library" moves the song folder to the macOS Trash (recoverable).
- `KARAOKAY_HOME=<dir>` keeps the database and default library in `<dir>` (used by all testing so the real `~/Music/Karaokay` is never touched). `KARAOKAY_SNAPSHOT=<png>` (+ `_SCRIPT`, `_DELAY`, `_AFTER`) runs a script in the renderer, captures the window and quits; `window.__karaokay` exposes the stores for such scripts.
- Test songs are generated by `node tools/make-fixtures.mjs tools/out/fixtures` (synthetic chords + sine "vocal", invented lyrics, four naming styles, one Windows-1252 SRT).

**Not done / known limits**

- No Playwright E2E suite; UI flows were verified by scripted snapshot runs instead (`tools/out/*.png`).
- Key detection quality on real recordings is untested until real songs are imported; confidence below 50 % shows a `?`.
- Only an arm64 macOS build is configured.
