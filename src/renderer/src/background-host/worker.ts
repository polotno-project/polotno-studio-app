import * as ort from 'onnxruntime-web/webgpu'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type { BackgroundModel } from '../../../shared/ipc-contract'
import type { HostJob, HostOutcome, HostResult } from '../../../shared/background-host'
import { hasWebGpu } from './webgpu'

// Runs the background removal models with onnxruntime-web: WebGPU when the
// machine has a real GPU adapter, else WASM (threaded: the page is
// cross-origin isolated). Pre- and post-processing follow the research
// harness (.claude/bg-remove/bench/worker.mjs).

ort.env.wasm.wasmPaths = { wasm: wasmUrl }
ort.env.logLevel = 'error'

// Both models take a 1024x1024 RGB image, squished to that size.
const SIZE = 1024
// Longest side of the result: Polotno's own cap for image tools (and
// Vision's in the Swift helper). Never upscales.
const MAX_SIDE = 4096
// Less than this share of the image kept: nothing to keep was found.
const MIN_COVERAGE = 0.005

interface Recipe {
  mean: [number, number, number]
  std: [number, number, number]
  // IS-Net outputs a sigmoid, min-max normalized per image (as in its
  // Inference.py); BiRefNet outputs logits.
  output: 'minmax' | 'sigmoid'
  webgpuOnly: boolean
  // BiRefNet: 'lazyRelease' cuts its GPU memory from 5.5-6 to 4.2-4.5 GB for
  // ~3-20% more time (PROGRESS.md "Benchmark (macOS)").
  webgpu: ort.InferenceSession.WebGpuExecutionProviderOption
}

const RECIPES: Record<BackgroundModel, Recipe> = {
  standard: {
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
    output: 'minmax',
    webgpuOnly: false,
    webgpu: { name: 'webgpu' }
  },
  hq: {
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    output: 'sigmoid',
    webgpuOnly: true,
    webgpu: { name: 'webgpu', storageBufferCacheMode: 'lazyRelease' } as Recipe['webgpu']
  }
}

class JobError extends Error {
  constructor(
    readonly outcome: Exclude<HostOutcome, { state: 'done' }>,
    message: string
  ) {
    super(message)
  }
}

interface Loaded {
  session: ort.InferenceSession
  backend: 'webgpu' | 'wasm'
}

const sessions = new Map<BackgroundModel, Promise<Loaded>>()

async function load(model: BackgroundModel, url: string): Promise<Loaded> {
  const recipe = RECIPES[model]
  const response = await fetch(url)
  if (!response.ok) throw new Error(`model: HTTP ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (await hasWebGpu()) {
    try {
      return {
        session: await ort.InferenceSession.create(bytes, {
          executionProviders: [recipe.webgpu],
          logSeverityLevel: 3
        }),
        backend: 'webgpu'
      }
    } catch (error) {
      if (recipe.webgpuOnly) throw error
      console.warn('WebGPU session failed, using WASM', error)
    }
  } else if (recipe.webgpuOnly) {
    throw new JobError({ state: 'failed' }, 'no WebGPU adapter')
  }
  return {
    session: await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      logSeverityLevel: 3
    }),
    backend: 'wasm'
  }
}

function session(model: BackgroundModel, url: string): Promise<Loaded> {
  let loaded = sessions.get(model)
  if (!loaded) {
    loaded = load(model, url)
    sessions.set(model, loaded)
    // A failed load is retried by the next job.
    loaded.catch(() => sessions.delete(model))
  }
  return loaded
}

async function decode(bytes: Uint8Array): Promise<ImageBitmap> {
  let image: ImageBitmap
  try {
    image = await createImageBitmap(new Blob([bytes as BlobPart]))
  } catch (error) {
    throw new JobError({ state: 'unreadable' }, String(error))
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height))
  if (scale === 1) return image
  const resized = await createImageBitmap(image, {
    resizeWidth: Math.max(1, Math.round(image.width * scale)),
    resizeHeight: Math.max(1, Math.round(image.height * scale)),
    resizeQuality: 'high'
  })
  image.close()
  return resized
}

function input(image: ImageBitmap, { mean, std }: Recipe): ort.Tensor {
  const canvas = new OffscreenCanvas(SIZE, SIZE)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, SIZE, SIZE)
  const rgba = ctx.getImageData(0, 0, SIZE, SIZE).data
  const n = SIZE * SIZE
  const chw = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) chw[c * n + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c]
  }
  return new ort.Tensor('float32', chw, [1, 3, SIZE, SIZE])
}

// Model output -> 0..255 mask at 1024x1024. NaN (BiRefNet in fp16 did that)
// fails the job rather than returning an empty or garbage cutout.
function mask(output: Float32Array, recipe: Recipe): Uint8ClampedArray {
  let min = Infinity
  let max = -Infinity
  for (const v of output) {
    if (Number.isNaN(v)) throw new JobError({ state: 'failed' }, 'NaN in the model output')
    if (v < min) min = v
    if (v > max) max = v
  }
  const alpha = new Uint8ClampedArray(output.length)
  if (recipe.output === 'minmax') {
    const k = max > min ? 255 / (max - min) : 0
    for (let i = 0; i < output.length; i++) alpha[i] = (output[i] - min) * k
  } else {
    for (let i = 0; i < output.length; i++) alpha[i] = 255 / (1 + Math.exp(-output[i]))
  }
  return alpha
}

// The mask scaled to the image's size becomes its alpha.
async function cutout(image: ImageBitmap, alpha: Uint8ClampedArray): Promise<Uint8Array> {
  const maskData = new ImageData(SIZE, SIZE)
  for (let i = 0; i < alpha.length; i++) maskData.data[i * 4 + 3] = alpha[i]
  const maskCanvas = new OffscreenCanvas(SIZE, SIZE)
  maskCanvas.getContext('2d')!.putImageData(maskData, 0, 0)

  const { width, height } = image
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(maskCanvas, 0, 0, width, height)
  const scaled = ctx.getImageData(0, 0, width, height).data
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height)
  let kept = 0
  for (let i = 3; i < scaled.length; i += 4) {
    pixels.data[i] = Math.min(pixels.data[i], scaled[i])
    if (scaled[i] >= 128) kept++
  }
  if (kept < width * height * MIN_COVERAGE) {
    throw new JobError(
      { state: 'noSubject' },
      `kept ${((100 * kept) / (width * height)).toFixed(2)}%`
    )
  }
  ctx.putImageData(pixels, 0, 0)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

// onnxruntime reports a full GPU in several ways (Dawn, ORT's allocator,
// the wasm heap).
const OUT_OF_MEMORY = /out of memory|outofmemory|bad_alloc|failed to allocate|device (was )?lost/i

async function run({ id, model, modelUrl, image }: HostJob): Promise<HostResult> {
  const recipe = RECIPES[model]
  const times: string[] = []
  let started = performance.now()
  const lap = (name: string): void => {
    const now = performance.now()
    times.push(`${name} ${Math.round(now - started)}`)
    started = now
  }
  let backend = '?'
  try {
    const loaded = await session(model, modelUrl)
    backend = loaded.backend
    lap('load')
    const bitmap = await decode(image)
    const size = `${bitmap.width}x${bitmap.height}`
    const tensor = input(bitmap, recipe)
    lap('pre')
    const outputs = await loaded.session.run({ [loaded.session.inputNames[0]]: tensor })
    const output = outputs[loaded.session.outputNames[0]]
    lap('run')
    const alpha = mask(output.data as Float32Array, recipe)
    output.dispose()
    const png = await cutout(bitmap, alpha)
    bitmap.close()
    lap('post')
    return {
      id,
      result: { state: 'done', png },
      detail: `${backend} ${size}, ms: ${times.join(', ')}`
    }
  } catch (error) {
    const message = (error as Error)?.message ?? String(error)
    const outcome: Exclude<HostOutcome, { state: 'done' }> =
      error instanceof JobError
        ? error.outcome
        : model === 'hq' && OUT_OF_MEMORY.test(message)
          ? { state: 'gpuMemory' }
          : { state: 'failed' }
    return { id, result: outcome, detail: `${backend}: ${message.slice(0, 500)}` }
  }
}

self.onmessage = async ({ data }: MessageEvent<HostJob>) => {
  const result = await run(data)
  const transfer = result.result.state === 'done' ? [result.result.png.buffer as ArrayBuffer] : []
  self.postMessage(result, { transfer })
}
