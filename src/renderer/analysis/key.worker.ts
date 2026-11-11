/// <reference lib="webworker" />
// Key detection with essentia.js KeyExtractor (EDMA profile), run off the main thread.
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js'
import Essentia from 'essentia.js/dist/essentia.js-core.es.js'

let essentia: Essentia | null = null

interface Req {
  id: string
  samples: Float32Array
  sampleRate: number
}

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, samples, sampleRate } = e.data
  try {
    essentia ??= new Essentia(EssentiaWASM)
    const r = essentia.KeyExtractor(essentia.arrayToVector(samples), true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'edma', sampleRate)
    self.postMessage({ id, ok: true, key: r.key, scale: r.scale, strength: r.strength })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
