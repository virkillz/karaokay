// Development self-test, run through KARAOKAY_SNAPSHOT_SCRIPT. Not used by the app UI.
import { api } from '../api'
import { engine } from '../audio/engine'
import { runKeyQueue } from '../analysis/keyQueue'
import { keyName } from '../../shared/keys'

const DETECTOR = `
class Det extends AudioWorkletProcessor {
  constructor() { super(); this.last = [-9, -9, -9, -9] }
  process(inputs) {
    const inp = inputs[0]
    for (const ch of [0, 2]) {
      const d = inp[ch]
      if (!d) continue
      for (let i = 0; i < d.length; i++) {
        const t = currentTime + i / sampleRate
        if (Math.abs(d[i]) > 0.15 && t - this.last[ch] > 0.4) {
          this.last[ch] = t
          this.port.postMessage({ ch, t })
          break
        }
      }
    }
    return true
  }
}
registerProcessor('karaokay-det', Det)
`

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function syncTest(): Promise<unknown> {
  await engine.init()
  const ctx = engine.ctx!
  const sr = ctx.sampleRate
  const dur = 12
  const ch = [0, 1, 2, 3].map(() => new Float32Array(dur * sr))
  for (let k = 1; k < dur; k++) {
    const s0 = Math.round(k * sr)
    for (let i = 0; i < Math.round(0.03 * sr); i++) {
      const v = 0.9 * Math.sin((2 * Math.PI * 1000 * i) / sr)
      for (const c of ch) c[s0 + i] = v
    }
  }
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([DETECTOR], { type: 'text/javascript' })))
  const det = new AudioWorkletNode(ctx, 'karaokay-det', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 4, channelCountMode: 'explicit', channelInterpretation: 'discrete' })
  engine.diagnosticTap!.connect(det)
  const hits: { ch: number; t: number }[] = []
  det.port.onmessage = (e) => hits.push(e.data)
  const timings: { lastInput: number; lastCtx: number }[] = []
  const poll = window.setInterval(() => {
    const t = engine.timing
    const prev = timings[timings.length - 1]
    if (!prev || prev.lastCtx !== t.lastCtx) timings.push({ ...t })
  }, 4)
  engine.setVolume(0)
  engine.setTranspose(0)
  await engine.loadPrepared({ songId: '__sync', channels: ch, duration: dur, hasVocals: true })
  await engine.play()
  await wait(3500)
  engine.setTranspose(3)
  await wait(3000)
  engine.setTranspose(-4)
  await wait(4800)
  engine.pause()
  clearInterval(poll)
  engine.diagnosticTap!.disconnect(det)
  engine.setTranspose(0)
  engine.setVolume(0.85)

  const estimate = (t: number): number | null => {
    let best: { lastInput: number; lastCtx: number } | null = null
    for (const s of timings) if (s.lastCtx <= t) best = s
    // detector time t is at the graph; heard at t + outputLatency, where engine.position subtracts both
    return best ? best.lastInput + (t - best.lastCtx) - engine.latencyComp : null
  }
  const rows = hits.map((h) => {
    const p = estimate(h.t)
    return { ch: h.ch, ctxT: +h.t.toFixed(4), est: p === null ? null : +p.toFixed(4), err: p === null ? null : +(p - Math.round(p)).toFixed(4) }
  })
  const pairs: number[] = []
  for (const a of rows.filter((r) => r.ch === 0)) {
    const b = rows.find((r) => r.ch === 2 && Math.abs(r.ctxT - a.ctxT) < 0.3)
    if (b) pairs.push(+(b.ctxT - a.ctxT).toFixed(5))
  }
  const errs = rows.filter((r) => r.ch === 0 && r.err !== null).map((r) => r.err as number)
  return {
    sampleRate: sr,
    latencyComp: engine.latencyComp,
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency,
    clicksDetected: rows.length,
    instVsVocalDiffs: pairs,
    positionErrors: errs,
    meanPositionError: errs.length ? +(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(4) : null,
    timingUpdates: timings.length
  }
}

export async function selfTest(dropDir: string): Promise<string> {
  const log: Record<string, unknown> = {}
  const t0 = performance.now()
  const { candidates: cands } = await api.invoke('importer:analyse', [dropDir])
  log.candidates = cands.map((c) => ({ title: c.title, artist: c.artist, genre: c.genre, inst: !!c.instrumental, voc: !!c.vocals, lrc: !!c.lyrics, action: c.action }))
  log.import = await api.invoke('importer:commit', cands)
  const t1 = performance.now()
  await runKeyQueue()
  const all = await api.invoke('library:search', {})
  log.keys = all.songs.map((s) => [s.title, s.key ? keyName(s.key) : null, s.key?.confidence, s.analysisStatus, Math.round(s.durationMs / 100) / 10])
  log.keyMs = Math.round(performance.now() - t1)
  log.importMs = Math.round(t1 - t0)
  log.searchMidn = (await api.invoke('library:search', { text: 'midn' })).songs.map((s) => s.title)
  log.searchArtist = (await api.invoke('library:search', { text: 'kilo' })).songs.map((s) => s.title)
  log.searchLyrics = (await api.invoke('library:search', { text: 'maple leaves' })).songs.map((s) => [s.title, s.snippet])
  log.searchGenre = (await api.invoke('library:search', { text: 'ballad' })).songs.map((s) => s.title)
  const nora = all.songs.find((s) => s.artist === 'Nora Vale')
  if (nora) log.noraLyrics = (await api.invoke('library:readLyrics', nora.id))?.split('\n').slice(0, 7)
  log.sync = await syncTest()
  return JSON.stringify(log, null, 1)
}
