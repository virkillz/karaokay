// Dev spike: node tools/align-spike.ts <model.onnx> <vocab.json> <audio> [lyrics.txt] [truth.json]
// Decodes audio with ffmpeg to 16 kHz mono, computes emissions, aligns lyrics, reports timing/accuracy.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loadSession, computeEmissions, FRAME_SEC, SAMPLE_RATE } from '../src/main/align/model.ts'
import { alignLines, linesToSrt, logSoftmax, prepareLyrics } from '../src/main/align/ctc.ts'

const [modelPath, vocabPath, audioPath, lyricsPath, truthPath] = process.argv.slice(2)
const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 })
const audio = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4)
const duration = audio.length / SAMPLE_RATE
console.log(`audio ${duration.toFixed(1)} s`)

let t = performance.now()
const session = await loadSession(modelPath)
console.log(`load ${Math.round(performance.now() - t)} ms, inputs ${session.inputNames} outputs ${session.outputNames}`)
t = performance.now()
const em = await computeEmissions(session, audio)
const emitMs = performance.now() - t
console.log(`emissions ${em.frames}×${em.classes} in ${Math.round(emitMs)} ms (${(duration / (emitMs / 1000)).toFixed(1)}× realtime)`)
logSoftmax(em.data, em.frames, em.classes)

// how much of the clip the model hears as non-blank (sanity check on real vocals)
let nonBlank = 0
for (let f = 0; f < em.frames; f++) if (Math.exp(em.data[f * em.classes]) < 0.5) nonBlank++
console.log(`non-blank frames ${((nonBlank / em.frames) * 100).toFixed(1)}%`)

if (lyricsPath) {
  const vocab = JSON.parse(readFileSync(vocabPath, 'utf8'))
  const lines = prepareLyrics(readFileSync(lyricsPath, 'utf8'), vocab)
  t = performance.now()
  const r = alignLines(lines, em.data, em.frames, em.classes, FRAME_SEC, duration)
  console.log(`align ${lines.length} lines in ${Math.round(performance.now() - t)} ms`)
  if (truthPath) {
    const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as { starts: number[] }
    // true onset: first 10 ms block above -35 dBFS after each placement time
    const onset = (from: number): number => {
      const blk = SAMPLE_RATE / 100
      for (let i = Math.floor(from * SAMPLE_RATE); i + blk < audio.length; i += blk) {
        let s = 0
        for (let j = 0; j < blk; j++) s += audio[i + j] ** 2
        if (Math.sqrt(s / blk) > 0.018) return i / SAMPLE_RATE
      }
      return from
    }
    const errs = r.lines.map((l, i) => {
      const truthStart = onset(truth.starts[i])
      return { line: i + 1, truth: +truthStart.toFixed(2), got: +l.start.toFixed(2), errMs: Math.round((l.start - truthStart) * 1000), score: +l.score.toFixed(2) }
    })
    console.table(errs)
    const abs = errs.map((e) => Math.abs(e.errMs))
    console.log(`mean |error| ${Math.round(abs.reduce((a, b) => a + b, 0) / abs.length)} ms, max ${Math.max(...abs)} ms`)
  } else {
    console.log(linesToSrt(r.lines).split('\n').filter((l) => l.includes('-->')).slice(0, 40).join('\n'))
  }
}
