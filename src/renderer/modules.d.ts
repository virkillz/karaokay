declare module 'signalsmith-stretch' {
  const SignalsmithStretch: (ctx: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioWorkletNode>
  export default SignalsmithStretch
}

declare module 'essentia.js/dist/essentia-wasm.es.js' {
  export const EssentiaWASM: unknown
}
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export default class Essentia {
    constructor(wasm: unknown, isDebug?: boolean)
    arrayToVector(a: Float32Array): unknown
    KeyExtractor(audio: unknown, ...args: unknown[]): { key: string; scale: string; strength: number }
  }
}
