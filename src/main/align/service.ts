// Lyric alignment service (main process): model download, alignment, saving lyrics.srt.
import { app, BrowserWindow, dialog } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { InferenceSession } from 'onnxruntime-node'
import type { AlignResult, AlignModelStatus } from '../../shared/types'
import { alignLines, linesToSrt, logSoftmax, prepareLyrics } from './ctc'
import { computeEmissions, FRAME_SEC, loadSession, SAMPLE_RATE } from './model'

const REPO = 'https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX/resolve/main'
const MODEL_FILE = 'model_int8.onnx'
const MODEL_SHA256 = '2eb5c3d2f6db2ef476aa7a7e1e5800145973e9064eb5292b1b9b8ada1207712a'
const MODEL_BYTES = 317341664

type Progress = (p: { stage: 'download' | 'analyse' | 'align'; progress: number }) => void

export class AlignService {
  private session: Promise<InferenceSession> | null = null
  private vocab: Record<string, number> | null = null
  private downloading: Promise<void> | null = null
  /** user-picked audio files, served to the renderer by token only */
  readonly pickedFiles = new Map<string, string>()

  get dir(): string {
    return path.join(app.getPath('userData'), 'models', 'mms-fa')
  }

  async status(): Promise<AlignModelStatus> {
    const ok = await fs
      .stat(path.join(this.dir, MODEL_FILE))
      .then((s) => s.size === MODEL_BYTES)
      .catch(() => false)
    const vocab = await fs.stat(path.join(this.dir, 'vocab.json')).then(() => true).catch(() => false)
    return { ready: ok && vocab, downloadMB: Math.round(MODEL_BYTES / 1e6) }
  }

  private async download(onProgress: Progress): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const vocabRes = await fetch(`${REPO}/vocab.json`)
    if (!vocabRes.ok) throw new Error(`model download failed (${vocabRes.status})`)
    await fs.writeFile(path.join(this.dir, 'vocab.json'), Buffer.from(await vocabRes.arrayBuffer()))

    const res = await fetch(`${REPO}/onnx/${MODEL_FILE}`)
    if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`)
    const total = Number(res.headers.get('content-length')) || MODEL_BYTES
    const tmp = path.join(this.dir, `${MODEL_FILE}.part`)
    const hash = createHash('sha256')
    let got = 0
    let lastReport = 0
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
    body.on('data', (chunk: Buffer) => {
      hash.update(chunk)
      got += chunk.length
      if (got - lastReport > 2_000_000) {
        lastReport = got
        onProgress({ stage: 'download', progress: got / total })
      }
    })
    await pipeline(body, createWriteStream(tmp))
    if (hash.digest('hex') !== MODEL_SHA256) {
      await fs.unlink(tmp).catch(() => undefined)
      throw new Error('downloaded model failed its checksum; please try again')
    }
    await fs.rename(tmp, path.join(this.dir, MODEL_FILE))
    onProgress({ stage: 'download', progress: 1 })
  }

  async ensureModel(onProgress: Progress): Promise<void> {
    if ((await this.status()).ready) return
    if (!this.downloading) this.downloading = this.download(onProgress).finally(() => (this.downloading = null))
    await this.downloading
  }

  private async getSession(): Promise<InferenceSession> {
    if (!this.session) {
      this.session = loadSession(path.join(this.dir, MODEL_FILE))
      this.session.catch(() => (this.session = null))
    }
    return this.session
  }

  private async getVocab(): Promise<Record<string, number>> {
    if (!this.vocab) this.vocab = JSON.parse(await fs.readFile(path.join(this.dir, 'vocab.json'), 'utf8')) as Record<string, number>
    return this.vocab
  }

  /** Align pasted lyrics to 16 kHz mono audio. `offsetSec` shifts results into the song's timeline. */
  async align(text: string, pcm: Float32Array, offsetSec: number, onProgress: Progress): Promise<AlignResult> {
    await this.ensureModel(onProgress)
    const vocab = await this.getVocab()
    const lines = prepareLyrics(text, vocab)
    if (lines.length === 0) throw new Error('Paste some lyrics first.')
    if (!lines.some((l) => l.words.some((w) => w.tokens.length))) throw new Error('None of these lyrics can be aligned (only Latin-alphabet text and transliterations are supported).')
    const session = await this.getSession()
    onProgress({ stage: 'analyse', progress: 0 })
    const em = await computeEmissions(session, pcm, (p) => onProgress({ stage: 'analyse', progress: p }))
    logSoftmax(em.data, em.frames, em.classes)
    onProgress({ stage: 'align', progress: 0 })
    const duration = pcm.length / SAMPLE_RATE
    const r = alignLines(lines, em.data, em.frames, em.classes, FRAME_SEC, duration)
    const shifted = r.lines.map((l) => ({ ...l, start: Math.max(0, l.start + offsetSec), end: Math.max(0, l.end + offsetSec) }))
    onProgress({ stage: 'align', progress: 1 })
    return { lines: shifted, srt: linesToSrt(shifted) }
  }

  async pickAudio(): Promise<{ token: string; name: string } | null> {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose the original recording (with vocals)',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'] }]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return null
    const token = randomUUID()
    this.pickedFiles.set(token, r.filePaths[0])
    return { token, name: path.basename(r.filePaths[0]) }
  }
}
