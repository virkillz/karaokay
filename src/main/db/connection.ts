import Database from 'better-sqlite3'

export type DB = Database.Database

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE songs (
    id                TEXT PRIMARY KEY,
    folder            TEXT NOT NULL UNIQUE,
    title             TEXT NOT NULL,
    artist            TEXT NOT NULL,
    album             TEXT,
    genre             TEXT,
    year              INTEGER,
    language          TEXT,
    duration_ms       INTEGER NOT NULL DEFAULT 0,
    instrumental      TEXT NOT NULL,
    vocals            TEXT,
    lyrics            TEXT,
    cover             TEXT,
    key_tonic         INTEGER,
    key_mode          TEXT,
    key_source        TEXT,
    key_confidence    REAL,
    analysis_status   TEXT NOT NULL DEFAULT 'pending',
    transpose         INTEGER NOT NULL DEFAULT 0,
    lyrics_offset_ms  INTEGER NOT NULL DEFAULT 0,
    vocal_offset_ms   INTEGER NOT NULL DEFAULT 0,
    guide_vocal_level REAL,
    favorite          INTEGER NOT NULL DEFAULT 0,
    play_count        INTEGER NOT NULL DEFAULT 0,
    last_played_at    TEXT,
    added_at          TEXT NOT NULL,
    missing           INTEGER NOT NULL DEFAULT 0,
    scan_signature    TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX songs_artist ON songs(artist COLLATE NOCASE);
  CREATE INDEX songs_genre ON songs(genre COLLATE NOCASE);

  CREATE VIRTUAL TABLE songs_fts USING fts5(
    title, artist, album, genre, lyrics_text,
    tokenize = "unicode61 remove_diacritics 2",
    prefix = '1 2 3'
  );

  CREATE TABLE playlists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE playlist_items (
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    PRIMARY KEY (playlist_id, position)
  );
  CREATE TABLE queue_items (
    id TEXT PRIMARY KEY,
    position INTEGER NOT NULL,
    song_id TEXT NOT NULL,
    transpose INTEGER
  );
  CREATE TABLE history (
    id INTEGER PRIMARY KEY,
    song_id TEXT NOT NULL,
    played_at TEXT NOT NULL,
    transpose INTEGER
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: pasted lyrics waiting for timing (lyrics.txt) and auto-timed lyrics waiting for a human check
  `
  ALTER TABLE songs ADD COLUMN lyrics_draft TEXT;
  ALTER TABLE songs ADD COLUMN lyrics_review INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: per-song focus theme and background video
  `
  ALTER TABLE songs ADD COLUMN theme TEXT;
  ALTER TABLE songs ADD COLUMN video TEXT;
  ALTER TABLE songs ADD COLUMN video_offset_ms INTEGER NOT NULL DEFAULT 0;
  `
]

export function openDatabase(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
