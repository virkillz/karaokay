#!/usr/bin/env node
// Generate synthetic karaoke songs (no copyrighted material) for development and tests.
// Usage: node tools/make-fixtures.mjs <outDir>
// Produces a "drop" folder with files named in the different styles the importer understands.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const out = path.resolve(process.argv[2] ?? 'tools/out/fixtures')
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const SR = 44100
const BAR = 2 // seconds per bar (120 bpm, 4/4)

const midi = (m) => 440 * 2 ** ((m - 69) / 12)

function wav(chL, chR) {
  const n = chL.length
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chL[i] * 32767))), 44 + i * 4)
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chR[i] * 32767))), 46 + i * 4)
  }
  return buf
}

function env(t, dur, a = 0.02, r = 0.15) {
  if (t < 0 || t > dur) return 0
  return Math.min(1, t / a) * Math.min(1, (dur - t) / r)
}

/**
 * chords: array of [root midi, 'maj'|'min'] per bar. melody: per bar, 4 quarter notes as scale midi (or null).
 * introBars: bars of instrumental before vocals start.
 */
function render({ chords, melody, introBars, outroBars }) {
  const bars = introBars + melody.length + outroBars
  const n = Math.round(bars * BAR * SR)
  const iL = new Float32Array(n), iR = new Float32Array(n), v = new Float32Array(n)
  for (let b = 0; b < bars; b++) {
    const [root, q] = chords[b % chords.length]
    const notes = [root - 12, root, root + (q === 'maj' ? 4 : 3), root + 7, root + 12]
    const t0 = b * BAR
    for (let i = Math.round(t0 * SR); i < Math.round((t0 + BAR) * SR) && i < n; i++) {
      const t = i / SR - t0
      let s = 0
      notes.forEach((m, k) => {
        const f = midi(m)
        const amp = k === 0 ? 0.22 : 0.09
        s += amp * env(t, BAR, 0.05, 0.3) * (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t))
      })
      // hat on every beat, kick on 1 and 3
      const beat = t % 0.5
      s += 0.05 * Math.exp(-beat * 60) * (Math.random() * 2 - 1)
      if (Math.floor(t / 0.5) % 2 === 0) s += 0.35 * Math.exp(-beat * 18) * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-beat * 30)) * beat)
      iL[i] += s * 0.9
      iR[i] += s * 0.8
    }
  }
  melody.forEach((barNotes, bi) => {
    const t0 = (introBars + bi) * BAR
    barNotes.forEach((m, qi) => {
      if (m === null) return
      const start = t0 + qi * 0.5
      const dur = 0.46
      const f = midi(m)
      for (let i = Math.round(start * SR); i < Math.round((start + dur) * SR) && i < n; i++) {
        const t = i / SR - start
        const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t)
        const ph = 2 * Math.PI * f * vib * t
        v[i] += 0.3 * env(t, dur, 0.03, 0.08) * (Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph))
      }
    })
  })
  return { inst: wav(iL, iR), voc: wav(v, v) }
}

function srt(lines, introBars) {
  // each lyric line spans 2 bars of melody
  return lines
    .map((text, i) => {
      const start = (introBars + i * 2) * BAR
      const end = start + 2 * BAR - 0.3
      const f = (s) => {
        const ms = Math.round(s * 1000)
        const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
        const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0')
        const sec = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
        return `${h}:${m}:${sec},${String(ms % 1000).padStart(3, '0')}`
      }
      return `${i + 1}\n${f(start)} --> ${f(end)}\n${text}\n`
    })
    .join('\n')
}

function scaleMelody(tonic, minor, bars) {
  const steps = minor ? [0, 2, 3, 5, 7, 8, 10, 12] : [0, 2, 4, 5, 7, 9, 11, 12]
  const pattern = [0, 2, 4, 2, 4, 5, 4, 2, 1, 2, 4, 7, 5, 4, 2, 0]
  const out = []
  for (let b = 0; b < bars; b++) {
    const row = []
    for (let q = 0; q < 4; q++) {
      const idx = pattern[(b * 4 + q) % pattern.length]
      row.push(q === 3 && b % 2 === 1 ? null : tonic + 12 + steps[idx])
    }
    out.push(row)
  }
  return out
}

const LYRICS = [
  ['Round and round the lights go by', "and I'm still holding on to you", 'Every horse is painted gold', 'every song we know by heart', 'Spin me slow and spin me high', "midnight's only getting started"],
  ['Quiet streets and a borrowed coat', 'one more hour before you go', "Say the words you never wrote", 'after midnight, before you', 'Turn the radio down low', "I'll remember how it goes"],
  ['Electric hum inside my chest', 'neon signs that never rest', 'Turn it up and let it ring', 'everybody wants to sing', 'Lightning in a city sky', 'neon midnight, you and I'],
  ['Porch light on and the engine cold', 'maple leaves are turning gold', 'Every corner knows my name', 'nothing here has ever changed', 'Take the long way home tonight', 'midnight on Maple Street']
]

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
const drop = path.join(out, 'drop')
mkdirSync(drop, { recursive: true })
const tmp = path.join(out, 'tmp')
mkdirSync(tmp, { recursive: true })

const songs = [
  // A♭ major, folder-per-song style, mp3, 4-bar intro for the countdown
  { id: 'carousel', tonic: 56, minor: false, chords: [[56, 'maj'], [61, 'maj'], [63, 'maj'], [56, 'maj']], intro: 4, lyrics: LYRICS[0] },
  // F♯ minor, flat folder with (Instrumental)/(Vocals) suffixes, flac
  { id: 'after', tonic: 54, minor: true, chords: [[54, 'min'], [50, 'maj'], [57, 'maj'], [52, 'maj']], intro: 2, lyrics: LYRICS[1] },
  // E minor, short suffixes, mp3 with ID3 tags, no lyrics
  { id: 'neon', tonic: 52, minor: true, chords: [[52, 'min'], [48, 'maj'], [55, 'maj'], [50, 'maj']], intro: 2, lyrics: LYRICS[2] },
  // G major, wav instrumental only + srt
  { id: 'maple', tonic: 55, minor: false, chords: [[55, 'maj'], [60, 'maj'], [62, 'maj'], [55, 'maj']], intro: 2, lyrics: LYRICS[3] }
]

for (const s of songs) {
  const melody = scaleMelody(s.tonic, s.minor, s.lyrics.length * 2)
  const { inst, voc } = render({ chords: s.chords, melody, introBars: s.intro, outroBars: 2 })
  const iw = path.join(tmp, `${s.id}_i.wav`), vw = path.join(tmp, `${s.id}_v.wav`)
  writeFileSync(iw, inst)
  writeFileSync(vw, voc)
  const lyr = srt(s.lyrics, s.intro)
  if (s.id === 'carousel') {
    const d = path.join(drop, 'The Paper Lanterns - Midnight Carousel')
    mkdirSync(d)
    ff(['-i', iw, '-b:a', '192k', path.join(d, 'instrumental.mp3')])
    ff(['-i', vw, '-b:a', '160k', path.join(d, 'vocals.mp3')])
    writeFileSync(path.join(d, 'lyrics.srt'), '﻿' + lyr.replace(/\n/g, '\r\n'))
  } else if (s.id === 'after') {
    const meta = ['-metadata', 'genre=Ballad']
    ff(['-i', iw, ...meta, path.join(drop, 'Nora Vale - After Midnight, Before You (Instrumental).flac')])
    ff(['-i', vw, path.join(drop, 'Nora Vale - After Midnight, Before You (Vocals).flac')])
    // Windows-1252 encoded with a curly apostrophe to exercise encoding detection
    const latin = Buffer.from(lyr.replace(/'/g, '’').replace(/’/g, '\x92'), 'latin1')
    writeFileSync(path.join(drop, 'Nora Vale - After Midnight, Before You.srt'), latin)
  } else if (s.id === 'neon') {
    const meta = ['-metadata', 'title=Neon Midnight (Instrumental)', '-metadata', 'artist=Kilo Static', '-metadata', 'genre=Rock', '-metadata', 'date=2021']
    ff(['-i', iw, ...meta, '-b:a', '192k', path.join(drop, 'neon_midnight_inst.mp3')])
    ff(['-i', vw, '-b:a', '160k', path.join(drop, 'neon_midnight_vox.mp3')])
  } else {
    ff(['-i', iw, '-metadata', 'artist=Dusty Hollow Band', '-metadata', 'title=Midnight on Maple Street', '-metadata', 'genre=Country', path.join(drop, 'Midnight on Maple Street.wav')])
    writeFileSync(path.join(drop, 'Midnight on Maple Street.srt'), lyr)
  }
}
rmSync(tmp, { recursive: true, force: true })
console.log('fixtures written to', drop)
