import { mediaUrl } from '../../shared/ipc'
import { parseTonic } from '../../shared/keys'
import type { Song } from '../../shared/types'
import { api } from '../api'
import { engine } from '../audio/engine'

const ANALYSIS_SR = 16000
const EXCERPT_SECONDS = 120

let worker: Worker | null = null
let seq = 0
const waiting = new Map<string, (r: { ok: boolean; key?: string; scale?: string; strength?: number; error?: string }) => void>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./key.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e) => {
      const cb = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      cb?.(e.data)
    }
  }
  return worker
}

/** Fetch and decode audio to 16 kHz mono (also used by lyric alignment). */
export async function decodeMono(url: string): Promise<Float32Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const data = await res.arrayBuffer()
  // decodeAudioData on an OfflineAudioContext resamples to its rate
  const off = new OfflineAudioContext(1, 1, ANALYSIS_SR)
  const buf = await off.decodeAudioData(data)
  const out = new Float32Array(buf.length)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / buf.numberOfChannels
  }
  return out
}

export async function detectKey(song: Song): Promise<{ tonic: number; mode: 'major' | 'minor'; confidence: number }> {
  const v = encodeURIComponent(song.folder)
  const inst = await decodeMono(mediaUrl(song.id, 'instrumental', v))
  if (song.hasVocals) {
    const voc = await decodeMono(mediaUrl(song.id, 'vocals', v)).catch(() => null)
    if (voc) for (let i = 0; i < Math.min(inst.length, voc.length); i++) inst[i] += 0.5 * voc[i]
  }
  let samples = inst
  const max = EXCERPT_SECONDS * ANALYSIS_SR
  if (samples.length > max) {
    const start = Math.floor((samples.length - max) / 2)
    samples = samples.slice(start, start + max)
  }
  const id = String(++seq)
  const r = await new Promise<{ ok: boolean; key?: string; scale?: string; strength?: number; error?: string }>((resolve) => {
    waiting.set(id, resolve)
    getWorker().postMessage({ id, samples, sampleRate: ANALYSIS_SR }, [samples.buffer])
  })
  if (!r.ok) throw new Error(r.error ?? 'analysis failed')
  const tonic = parseTonic(r.key ?? '')
  if (tonic === null) throw new Error(`unrecognised key ${r.key}`)
  return { tonic, mode: r.scale === 'minor' ? 'minor' : 'major', confidence: Math.round((r.strength ?? 0) * 100) / 100 }
}

let running = false
let again = false

/** Analyse every song whose key is unknown, one at a time, in the background. */
export async function runKeyQueue(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      const ids = await api.invoke('analysis:pending')
      for (const id of ids) {
        // stay out of the way while a song is loading
        while (engine.state === 'loading') await new Promise((r) => setTimeout(r, 500))
        const song = await api.invoke('library:get', id)
        if (!song || song.missing || song.key) continue
        try {
          const key = await detectKey(song)
          await api.invoke('analysis:saveKey', id, key)
        } catch (e) {
          await api.invoke('analysis:markFailed', id, e instanceof Error ? e.message : String(e))
        }
      }
    } while (again)
  } finally {
    running = false
  }
}
