// Runs the MMS forced-aligner CTC model (ONNX) over long audio in overlapping windows.
import * as ort from 'onnxruntime-node'

export const SAMPLE_RATE = 16000
export const FRAME_SEC = 0.02 // wav2vec2 conv stride 320 samples @ 16 kHz
const WINDOW_SEC = 30
const CONTEXT_SEC = 1.5

export interface Emissions {
  /** frames × classes raw logits (log-softmax applied by the caller) */
  data: Float32Array
  frames: number
  classes: number
}

export async function loadSession(modelPath: string): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: 0
  })
}

function normalise(x: Float32Array): Float32Array {
  let mean = 0
  for (let i = 0; i < x.length; i++) mean += x[i]
  mean /= x.length || 1
  let v = 0
  for (let i = 0; i < x.length; i++) v += (x[i] - mean) ** 2
  const std = Math.sqrt(v / (x.length || 1) + 1e-7)
  const out = new Float32Array(x.length)
  for (let i = 0; i < x.length; i++) out[i] = (x[i] - mean) / std
  return out
}

/** Frame-level logits for the whole clip. `onProgress` gets 0..1. */
export async function computeEmissions(session: ort.InferenceSession, audio: Float32Array, onProgress?: (p: number) => void): Promise<Emissions> {
  const total = audio.length / SAMPLE_RATE
  const totalFrames = Math.ceil(total / FRAME_SEC)
  let classes = 0
  let data: Float32Array | null = null
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  const windows = Math.max(1, Math.ceil(total / WINDOW_SEC))
  for (let w = 0; w < windows; w++) {
    const a = w * WINDOW_SEC
    const b = Math.min(total, a + WINDOW_SEC)
    const winStart = Math.max(0, a - CONTEXT_SEC)
    const winEnd = Math.min(total, b + CONTEXT_SEC)
    const slice = audio.subarray(Math.floor(winStart * SAMPLE_RATE), Math.ceil(winEnd * SAMPLE_RATE))
    if (slice.length < 400) continue
    const input = new ort.Tensor('float32', normalise(slice), [1, slice.length])
    const res = await session.run({ [inputName]: input })
    const logits = res[outputName]
    const [, f, c] = logits.dims as number[]
    const vals = logits.data as Float32Array
    if (!data) {
      classes = c
      data = new Float32Array(totalFrames * classes)
    }
    // keep this window's frames that fall inside [a, b)
    const first = Math.round(a / FRAME_SEC)
    const last = Math.min(totalFrames, Math.round(b / FRAME_SEC))
    for (let g = first; g < last; g++) {
      const local = Math.round((g * FRAME_SEC - winStart) / FRAME_SEC)
      const src = Math.min(f - 1, Math.max(0, local))
      data.set(vals.subarray(src * c, src * c + c), g * classes)
    }
    onProgress?.((w + 1) / windows)
  }
  if (!data) throw new Error('audio is too short')
  return { data, frames: totalFrames, classes }
}
