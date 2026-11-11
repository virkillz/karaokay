import SignalsmithStretch from 'signalsmith-stretch'
import { mediaUrl } from '../../shared/ipc'
import type { Song } from '../../shared/types'

export type EngineState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error'

interface StretchNode extends AudioWorkletNode {
  inputTime: number
  schedule(opts: Record<string, number | boolean>): Promise<unknown>
  addBuffers(buffers: Float32Array[]): Promise<number>
  dropBuffers(toSeconds?: number): Promise<unknown>
  setUpdateInterval(seconds: number, cb?: (t: number) => void): Promise<unknown>
  latency(): number | Promise<number>
}

/** Four channels: 0-1 instrumental L/R, 2-3 vocal L/R. Processed by one node so they cannot drift. */
export interface PreparedSong {
  songId: string
  channels: Float32Array[]
  duration: number
  hasVocals: boolean
}

type Listener = () => void

const FADE_TC = 0.015

export class AudioEngine {
  ctx: AudioContext | null = null
  private node: StretchNode | null = null
  private instGain!: GainNode
  private vocalGain!: GainNode
  private master!: GainNode
  /** tap point for diagnostics: the 4-channel splitter */
  splitter!: ChannelSplitterNode
  private initPromise: Promise<void> | null = null

  state: EngineState = 'idle'
  songId: string | null = null
  duration = 0
  hasVocals = false
  private playing = false
  private pausedAt = 0
  private lastInput = 0
  private lastCtx = 0
  private semitones = 0
  private volume = 0.85
  private vocalLevel = 0.3
  private loadToken = 0
  private endTimer: number | null = null
  private listeners = new Set<Listener>()
  private endedListeners = new Set<Listener>()
  private cache = new Map<string, Promise<PreparedSong>>()
  error: string | null = null

  on(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
  onEnded(cb: Listener): () => void {
    this.endedListeners.add(cb)
    return () => this.endedListeners.delete(cb)
  }
  private emit(): void {
    for (const l of this.listeners) l()
  }

  private setState(s: EngineState): void {
    this.state = s
    this.emit()
  }

  init(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'playback' })
    this.ctx = ctx
    const node = (await SignalsmithStretch(ctx, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [4]
    })) as StretchNode
    this.node = node
    this.splitter = ctx.createChannelSplitter(4)
    const instMerge = ctx.createChannelMerger(2)
    const vocMerge = ctx.createChannelMerger(2)
    this.instGain = ctx.createGain()
    this.vocalGain = ctx.createGain()
    this.master = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -1
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.1

    node.connect(this.splitter)
    this.splitter.connect(instMerge, 0, 0)
    this.splitter.connect(instMerge, 1, 1)
    this.splitter.connect(vocMerge, 2, 0)
    this.splitter.connect(vocMerge, 3, 1)
    instMerge.connect(this.instGain).connect(this.master)
    vocMerge.connect(this.vocalGain).connect(this.master)
    this.master.connect(limiter).connect(ctx.destination)
    this.master.gain.value = this.volume
    this.vocalGain.gain.value = this.vocalLevel

    await node.setUpdateInterval(0.03, (t) => {
      this.lastInput = t
      this.lastCtx = ctx.currentTime
    })
    await node.schedule({ active: false, input: 0, rate: 1, semitones: 0 })
    try {
      const l = await node.latency()
      if (typeof l === 'number' && l > 0.01 && l < 0.5) this.latencyComp = l
    } catch {
      /* keep the measured default */
    }
  }

  /**
   * The stretch node reports input time at its processing point, which runs ahead of its output by
   * its own latency (measured at ~120 ms with default settings), and the speakers add outputLatency.
   */
  latencyComp = 0.12

  /** Seconds of the song being heard now. */
  get position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt
    const p = this.lastInput + (this.ctx.currentTime - this.lastCtx) - this.latencyComp - (this.ctx.outputLatency || 0)
    return Math.max(0, Math.min(this.duration, p))
  }

  get isPlaying(): boolean {
    return this.playing
  }

  // ---------- loading

  private async fetchDecode(url: string): Promise<AudioBuffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`could not read audio (${res.status})`)
    const data = await res.arrayBuffer()
    return this.ctx!.decodeAudioData(data)
  }

  prepare(song: Song): Promise<PreparedSong> {
    const cached = this.cache.get(song.id)
    if (cached) return cached
    const p = this.doPrepare(song)
    this.cache.set(song.id, p)
    p.catch(() => this.cache.delete(song.id))
    // keep at most two prepared songs (current + next)
    while (this.cache.size > 2) {
      const oldest = [...this.cache.keys()].find((k) => k !== song.id && k !== this.songId)
      if (!oldest) break
      this.cache.delete(oldest)
    }
    return p
  }

  private async doPrepare(song: Song): Promise<PreparedSong> {
    await this.init()
    const v = encodeURIComponent(song.folder)
    const [inst, voc] = await Promise.all([
      this.fetchDecode(mediaUrl(song.id, 'instrumental', v)),
      song.hasVocals ? this.fetchDecode(mediaUrl(song.id, 'vocals', v)).catch(() => null) : Promise.resolve(null)
    ])
    const sr = this.ctx!.sampleRate
    const off = Math.round((song.vocalOffsetMs / 1000) * sr)
    const vocLen = voc ? voc.length + Math.max(0, off) : 0
    const len = Math.max(inst.length, vocLen)
    const ch = [0, 1, 2, 3].map(() => new Float32Array(len))
    ch[0].set(inst.getChannelData(0))
    ch[1].set(inst.getChannelData(inst.numberOfChannels > 1 ? 1 : 0))
    if (voc) {
      const l = voc.getChannelData(0)
      const r = voc.getChannelData(voc.numberOfChannels > 1 ? 1 : 0)
      if (off >= 0) {
        ch[2].set(l.subarray(0, len - off), off)
        ch[3].set(r.subarray(0, len - off), off)
      } else {
        ch[2].set(l.subarray(-off, -off + len))
        ch[3].set(r.subarray(-off, -off + len))
      }
    }
    return { songId: song.id, channels: ch, duration: len / sr, hasVocals: !!voc }
  }

  /** Load a song (paused at 0). Resolves when it can play. */
  async load(song: Song, opts: { transpose: number; vocalLevel: number }): Promise<void> {
    const token = ++this.loadToken
    this.stopInternal()
    this.songId = song.id
    this.error = null
    this.duration = song.durationMs / 1000
    this.semitones = opts.transpose
    this.setVocalLevel(opts.vocalLevel)
    this.setState('loading')
    try {
      const prepared = await this.prepare(song)
      if (token !== this.loadToken) return
      await this.loadPrepared(prepared, token)
    } catch (e) {
      if (token !== this.loadToken) return
      this.error = e instanceof Error ? e.message : String(e)
      this.setState('error')
      throw e
    }
  }

  /** Hand decoded channels to the stretch node. Also used by the self-test. */
  async loadPrepared(prepared: PreparedSong, token = ++this.loadToken): Promise<void> {
    await this.init()
    const node = this.node!
    if (prepared.songId !== this.songId) {
      this.stopInternal()
      this.songId = prepared.songId
    }
    await node.schedule({ active: false, input: 0, rate: 1, semitones: this.semitones })
    await node.dropBuffers()
    await node.addBuffers(prepared.channels)
    if (token !== this.loadToken) return
    this.duration = prepared.duration
    this.hasVocals = prepared.hasVocals
    this.pausedAt = 0
    this.lastInput = 0
    this.lastCtx = this.ctx!.currentTime
    await node.schedule({ active: false, input: 0, rate: 1, semitones: this.semitones })
    this.master.gain.setTargetAtTime(this.volume, this.ctx!.currentTime, FADE_TC)
    this.setState('ready')
  }

  /** The stretch node, for diagnostics only. */
  get diagnosticTap(): AudioNode | null {
    return this.node
  }

  /** Raw (uninterpolated) timing info for diagnostics. */
  get timing(): { lastInput: number; lastCtx: number } {
    return { lastInput: this.lastInput, lastCtx: this.lastCtx }
  }

  async play(): Promise<void> {
    if (!this.node || !this.ctx || !this.songId) return
    if (this.state === 'loading' || this.state === 'error') return
    await this.ctx.resume()
    let from = this.pausedAt
    if (this.state === 'ended' || from >= this.duration - 0.05) from = 0
    this.lastInput = from
    this.lastCtx = this.ctx.currentTime
    this.playing = true
    void this.node.schedule({ active: true, input: from, rate: 1, semitones: this.semitones })
    this.watchEnd()
    this.setState('playing')
  }

  pause(): void {
    if (!this.node || !this.playing) return
    this.pausedAt = this.position
    this.playing = false
    void this.node.schedule({ active: false, input: this.pausedAt, rate: 1, semitones: this.semitones })
    this.unwatchEnd()
    this.setState('paused')
  }

  toggle(): void {
    if (this.playing) this.pause()
    else void this.play()
  }

  seek(seconds: number): void {
    if (!this.node || !this.ctx) return
    const t = Math.max(0, Math.min(this.duration - 0.05, seconds))
    this.pausedAt = t
    this.lastInput = t
    this.lastCtx = this.ctx.currentTime
    void this.node.schedule({ active: this.playing, input: t, rate: 1, semitones: this.semitones })
    if (this.state === 'ended') this.setState('paused')
    this.emit()
  }

  setTranspose(semitones: number): void {
    this.semitones = semitones
    if (!this.node) return
    // re-anchor input at the current position so nothing jumps
    const t = this.position
    this.lastInput = t
    this.lastCtx = this.ctx!.currentTime
    void this.node.schedule({ active: this.playing, input: t, rate: 1, semitones })
    this.emit()
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, FADE_TC)
  }

  setVocalLevel(v: number): void {
    this.vocalLevel = Math.max(0, Math.min(1, v))
    if (this.ctx) this.vocalGain.gain.setTargetAtTime(this.vocalLevel, this.ctx.currentTime, FADE_TC)
  }

  /** Fade out over `ms`, then pause. */
  async fadeOut(ms = 300): Promise<void> {
    if (!this.ctx || !this.playing) return
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, ms / 1000 / 4)
    await new Promise((r) => setTimeout(r, ms))
    this.pause()
  }

  unload(): void {
    this.loadToken++
    this.stopInternal()
    this.songId = null
    this.duration = 0
    this.pausedAt = 0
    this.setState('idle')
  }

  private stopInternal(): void {
    this.unwatchEnd()
    if (this.playing && this.node) void this.node.schedule({ active: false, rate: 1, semitones: this.semitones })
    this.playing = false
  }

  private watchEnd(): void {
    this.unwatchEnd()
    this.endTimer = window.setInterval(() => {
      if (this.playing && this.position >= this.duration - 0.03) {
        this.pausedAt = this.duration
        this.playing = false
        void this.node?.schedule({ active: false, rate: 1, semitones: this.semitones })
        this.unwatchEnd()
        this.setState('ended')
        for (const l of this.endedListeners) l()
      }
    }, 50)
  }

  private unwatchEnd(): void {
    if (this.endTimer !== null) clearInterval(this.endTimer)
    this.endTimer = null
  }
}

export const engine = new AudioEngine()
