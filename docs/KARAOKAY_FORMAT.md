# The `.karaokay` song package — format version 1

A `.karaokay` file carries one or more karaoke songs (audio, lyrics, artwork, video and per-song settings) in a single file that Karaokay can import and export. This document is the contract for anything that **writes** packages (for example a separate generator project) and for Karaokay's **reader**.

The reference implementation is `src/main/library/karaokayFile.ts` (reading/writing) and `src/main/library/importer.ts` (`commitPackageSong`, what happens on import). Keep this document in step with them.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

---

## 1. Container

| Property | Value |
|---|---|
| Container | Standard ZIP archive (PKWARE APPNOTE). ZIP64 MUST be used when a file or the archive exceeds 4 GiB. |
| File extension | `.karaokay` |
| MIME type | `application/vnd.karaokay+zip` |
| Compression | Each entry MAY be *stored* (method 0) or *deflated* (method 8). No other methods. |
| Encryption | Not allowed. Encrypted entries are skipped. |
| File names | UTF-8 (set general-purpose flag bit 11), forward slashes `/` only. |
| Entry order | Any order. Karaokay writes `manifest.json` last. |

**Recommended:** *store* media files (`.flac .mp3 .wav .jpg .png .mp4 …`), because they are already compressed; *deflate* JSON and lyric files. This makes export/import fast and costs almost no space.

## 2. Layout

```
My Songs.karaokay
├── manifest.json                         required
└── songs/
    ├── Queen - Bohemian Rhapsody/        one folder per song
    │   ├── song.json                     required
    │   ├── instrumental.flac             required  (.flac | .wav | .mp3)
    │   ├── vocals.flac                   optional  (.flac | .wav | .mp3)
    │   ├── lyrics.srt                    optional  timed lyrics
    │   ├── lyrics.txt                    optional  untimed lyrics (used only without lyrics.srt)
    │   ├── cover.jpg                     optional  (.jpg | .jpeg | .png)
    │   └── background.mp4                optional  (.mp4 | .m4v | .mov | webm)
    └── Another Artist - Another Song/
        └── …
```

Rules:

- Every song lives in its own folder directly under `songs/`. The folder name is free text (one path segment, ≤ 200 characters, no `/`, `\` or control characters, not `.` or `..`). `Artist - Title` is the convention, and it is used as a fallback title/artist when `song.json` lacks them.
- File names inside a song folder MUST be exactly the names in the table in §5. Matching is case-insensitive, but writers SHOULD use lower case.
- Anything else (other files, nested folders, files at the archive root other than `manifest.json`) is **ignored** with a warning. Songs MUST NOT depend on extra files.
- The same path MUST NOT appear twice, even when differing only in case.
- Paths MUST be relative; absolute paths, `..` segments, backslashes and symbolic links are rejected (the whole archive for unsafe names, the single entry for symlinks).

## 3. `manifest.json`

UTF-8 JSON (a BOM is tolerated), at most 1 MiB.

```json
{
  "format": "karaokay",
  "formatVersion": 1,
  "generator": "my-generator 0.3.0",
  "createdAt": "2026-11-11T10:00:00.000Z",
  "songs": [
    {
      "path": "songs/Queen - Bohemian Rhapsody",
      "files": {
        "song.json":         { "size": 480,     "sha256": "322c26…0766" },
        "instrumental.flac": { "size": 1296577, "sha256": "a1a015…1147" },
        "lyrics.srt":        { "size": 375,     "sha256": "26fbc4…cfff1" }
      }
    }
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `format` | string | **yes** | Always `"karaokay"`. |
| `formatVersion` | integer | **yes** | `1` for this document. Readers refuse versions newer than they support ("made by a newer Karaokay"). |
| `generator` | string | no | Name/version of the tool that wrote the file (≤ 200 chars). Informational. |
| `createdAt` | string | no | ISO 8601 timestamp. Informational. |
| `songs` | array | **yes** | At most 5000 entries. Only folders listed here are imported. |
| `songs[].path` | string | **yes** | `"songs/<folder>"`. A trailing `/` is allowed. |
| `songs[].files` | object | no | Integrity data, keyed by file name within the song folder. |
| `songs[].files[name].size` | integer | no | Uncompressed size in bytes. If present and different, the song fails to import. |
| `songs[].files[name].sha256` | string | no | Lower-case hex SHA-256 of the uncompressed bytes. If present and different, the song fails to import ("damaged"). |

`files` is optional and partial: a generator MAY omit it entirely, or list only some files. Karaokay always writes `size` and `sha256` for every file, including `song.json`.

Unknown top-level or per-song fields are ignored, so later minor additions don't need a version bump.

## 4. `song.json`

UTF-8 JSON, at most 1 MiB. This is the same `schema: 1` document Karaokay keeps in every song folder of its library.

```json
{
  "schema": 1,
  "id": "6f1c3a52-6a0e-4b8e-9d55-2a7f0a1c9e10",
  "title": "Bohemian Rhapsody",
  "artist": "Queen",
  "album": "A Night at the Opera",
  "genre": "Rock",
  "year": 1975,
  "language": "en",
  "key": { "tonic": 10, "mode": "major", "source": "manual", "confidence": null },
  "bpm": 72,
  "transpose": 0,
  "lyricsOffsetMs": 0,
  "vocalOffsetMs": 0,
  "guideVocalLevel": 0.3,
  "lyricsReview": false,
  "videoOffsetMs": 0,
  "theme": "party",
  "addedAt": "2026-11-11T10:00:00.000Z"
}
```

| Field | Type | Default if missing/invalid | Notes |
|---|---|---|---|
| `schema` | `1` | — | Writers SHOULD set it. |
| `id` | string | new UUID | See §6.1. Writers SHOULD use a UUID v4 and keep it **stable** for the same song across regenerations. |
| `title` | string | from folder name | Trimmed; empty counts as missing. |
| `artist` | string | from folder name, else `"Unknown Artist"` | |
| `album` | string \| null | `null` | |
| `genre` | string \| null | `null` | Free text (≤ 60 chars kept). |
| `year` | integer \| null | `null` | 1–2999. |
| `language` | string \| null | `null` | Free text; ISO 639-1 (`"en"`, `"id"`, `"ja"`) recommended. |
| `key` | object \| null | `null` → detected after import | `tonic`: pitch class 0–11 (C=0, C♯=1 … B=11); `mode`: `"major"` \| `"minor"`; `source`: `"manual"` \| `"detected"`; `confidence`: number 0–1 or `null`. |
| `bpm` | number \| null | `null` | Informational. |
| `transpose` | integer | `0` | Semitones, clamped to −6…+6. |
| `lyricsOffsetMs` | integer | `0` | Shifts lyric timing; positive shows lyrics later. Clamped to ±10000. |
| `vocalOffsetMs` | integer | `0` | Aligns the vocal track to the instrumental. Clamped to ±10000. |
| `guideVocalLevel` | number \| null | `null` (app default) | 0–1, the volume of the guide vocal. |
| `lyricsReview` | boolean | `false` | `true` = lyrics were timed automatically and should be checked. Kept only when `lyrics.srt` is present. |
| `videoOffsetMs` | integer | `0` | Milliseconds into `background.*` where the song starts (positive skips an intro). Clamped to ±600000. Kept only when a video is present. |
| `theme` | string \| null | `null` (app default) | One of `party`, `midnight`, `neon`, `warm`, `clean`. Unknown values become `null`. |
| `addedAt` | string | — | **Ignored on import**: the song is "added" when it enters the library. |

Unknown fields are ignored. Out-of-range numbers are clamped as shown, not rejected.

## 5. Media and lyric files

| File | Required | Formats | Size limit | Notes |
|---|---|---|---|---|
| `instrumental.<ext>` | **yes** | `flac`, `wav`, `mp3` | 2 GiB | The backing track. If several exist, the preference is FLAC → WAV → MP3. |
| `vocals.<ext>` | no | `flac`, `wav`, `mp3` | 2 GiB | Lead vocal stem, the same length and alignment as the instrumental. Enables the guide vocal and automatic lyric timing. |
| `lyrics.srt` | no | SubRip | 5 MiB | Timed lyrics, see §5.1. |
| `lyrics.txt` | no | plain text | 5 MiB | Untimed lyrics, one karaoke line per line. Ignored when `lyrics.srt` exists. With a vocal track, Karaokay times them automatically after import. |
| `cover.<ext>` | no | `jpg`, `jpeg`, `png` | 20 MiB | Square artwork recommended (≥ 600×600). |
| `background.<ext>` | no | `mp4`, `m4v`, `mov`, `webm` | 8 GiB | Muted background video shown in focus mode. H.264/AAC MP4 is the safest choice. |

A file over its size limit is left out (with a warning); a song whose instrumental is missing or too large is left out entirely.

### 5.1 `lyrics.srt`

- Standard SubRip: numbered cues, `HH:MM:SS,mmm --> HH:MM:SS,mmm`, then text, then a blank line.
- One cue = one karaoke line. A cue MAY have two text lines.
- Times are relative to the start of the instrumental (before `lyricsOffsetMs` is applied).
- Writers SHOULD use UTF-8. Readers also accept a UTF-8/UTF-16 BOM or a legacy encoding (auto-detected) and convert it to UTF-8 on import.

```
1
00:00:12,400 --> 00:00:15,900
Is this the real life?

2
00:00:16,100 --> 00:00:19,800
Is this just fantasy?
```

## 6. Import behaviour (Karaokay ≥ 0.1)

What Karaokay does with a package. Generators can rely on this.

1. **Discovery.** A `.karaokay` file can be opened with *Import Songs…*, dropped on the window (alone, mixed with loose files, or inside a dropped folder) or double-clicked in Finder.
2. **Preview.** Each listed song shows in the import dialog with its title, artist and genre (editable) and the files it contains. Problems (unreadable archive, left-out songs, ignored files) appear as notices; the rest still imports.
3. **Duplicates.** A song is a duplicate when its `id` already exists in the library, **or** a song with the same artist + title (case-insensitive) exists. Duplicates default to *Skip*; the user can choose:
   - **Replace**: the existing song keeps its id, folder, favourite, play count, history and playlists; its media, lyrics and settings are replaced by the package's.
   - **Keep both**: imported as a new song with a fresh id.
4. **ids.** A non-duplicate song keeps the package's `id` if it matches `^[A-Za-z0-9_-]{8,64}$`; otherwise it gets a new UUID. Keeping the id means that re-importing a regenerated package is recognised as the same song.
5. **Integrity.** Files are extracted to a hidden staging folder inside the library, sizes and hashes are verified against the manifest, lyric files are normalised to UTF-8, and only then is the folder moved into place. A failure leaves the library untouched.
6. **Afterwards.** Without a `key`, the key is detected in the background. With `lyrics.txt` + vocals and no `lyrics.srt`, the lyrics are timed in the background.

Never exported, never imported: favourites, play counts, history, queue and playlist membership (these belong to a library, not a song).

## 7. Export behaviour

- From a song's context menu (**Export as .karaokay…**) or a playlist (**Export…**, every available song in the playlist).
- The user chooses whether to include background videos (asked only when a song has one).
- The library's lyrics file is always exported as `lyrics.srt`; `lyrics.txt` is exported only when there are no timed lyrics.
- Song folders are named `Artist - Title`, with ` (2)`, ` (3)` … added on clashes.
- The file is written as `<name>.<pid>.part` and renamed when complete.

## 8. Writing a generator: checklist

1. Produce `instrumental.*` (and ideally `vocals.*`) as separate, sample-aligned stems.
2. Write `lyrics.srt` (or `lyrics.txt` if you only have text and a vocal stem).
3. Write `song.json` with at least `schema`, `id` (stable UUID), `title` and `artist`. Add `key`, `language`, `genre`, `year` and `cover.jpg` if you have them.
4. Zip as `songs/<Artist - Title>/…` + `manifest.json` with `format`, `formatVersion: 1` and `songs[].path`. Store media, deflate text, and use ZIP64 for large files.
5. Optional but recommended: include `files` with `size` + `sha256` in the manifest.

### Minimal valid package

```
manifest.json            {"format":"karaokay","formatVersion":1,"songs":[{"path":"songs/Me - My Song"}]}
songs/Me - My Song/song.json          {"schema":1,"title":"My Song","artist":"Me"}
songs/Me - My Song/instrumental.mp3
```

### Python example

```python
import hashlib, json, uuid, zipfile
from pathlib import Path

def write_karaokay(dest, songs, generator="my-generator 1.0"):
    """songs: list of dicts {"meta": {...song.json fields...}, "files": {"instrumental.flac": Path, ...}}"""
    STORE = {".flac", ".wav", ".mp3", ".jpg", ".jpeg", ".png", ".mp4", ".m4v", ".mov", ".webm"}
    manifest = {"format": "karaokay", "formatVersion": 1, "generator": generator, "songs": []}
    with zipfile.ZipFile(dest, "w", allowZip64=True) as z:
        for s in songs:
            meta = {"schema": 1, "id": s["meta"].get("id") or str(uuid.uuid4()), **s["meta"]}
            name = f"{meta['artist']} - {meta['title']}"
            folder = "songs/" + "".join(" " if c in '/\\:*?"<>|' or ord(c) < 32 else c for c in name).strip(" .")
            entry = {"path": folder, "files": {}}
            data = json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8")
            z.writestr(f"{folder}/song.json", data, zipfile.ZIP_DEFLATED)
            entry["files"]["song.json"] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for name, src in s["files"].items():
                src = Path(src)
                method = zipfile.ZIP_STORED if src.suffix.lower() in STORE else zipfile.ZIP_DEFLATED
                z.write(src, f"{folder}/{name}", compress_type=method)
                h = hashlib.sha256()
                with open(src, "rb") as f:
                    for chunk in iter(lambda: f.read(1 << 20), b""):
                        h.update(chunk)
                entry["files"][name] = {"size": src.stat().st_size, "sha256": h.hexdigest()}
            manifest["songs"].append(entry)
        z.writestr("manifest.json", json.dumps(manifest, indent=2), zipfile.ZIP_DEFLATED)

write_karaokay("out.karaokay", [{
    "meta": {"title": "My Song", "artist": "Me", "language": "en"},
    "files": {"instrumental.flac": "inst.flac", "vocals.flac": "vox.flac", "lyrics.srt": "lyrics.srt"},
}])
```

(Python's `zipfile` writes UTF-8 names with flag bit 11 automatically when a name is not ASCII.)

## 9. Versioning

- Additive, backwards-compatible changes (new optional fields, new optional files that old readers can ignore) keep `formatVersion: 1`.
- Anything an older reader would get wrong (new required files, changed meanings) bumps `formatVersion`. Older Karaokay versions then refuse the file with a clear message instead of importing it wrongly.
