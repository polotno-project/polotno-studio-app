import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import logger from 'electron-log/main'
import type { BackgroundModel, ModelDownloadResult } from '../shared/ipc-contract'

// The background removal models the app downloads on first use (they are
// too big to ship in the installer). Both are our own ONNX exports, rebuilt
// by scripts/background-models/ and published as assets of a GitHub release
// that is not an app release (its tag isn't semver, so the updater skips it).
// Licences and citations: THIRD_PARTY_NOTICES.md.

const log = logger.create({ logId: 'background-models' })
log.transports.file.fileName = 'remove-background.log'

// POLOTNO_BACKGROUND_MODELS_URL points at another copy (a local folder as a
// file:// URL works), to try downloads before a release is published.
const RELEASE_URL =
  process.env.POLOTNO_BACKGROUND_MODELS_URL ??
  'https://github.com/polotno-project/polotno-studio-app/releases/download/background-models-v1'

interface ModelFile {
  file: string
  bytes: number
  sha256: string
}

const MODELS: Record<BackgroundModel, ModelFile> = {
  // IS-Net (github.com/xuebinqin/DIS, isnet-general-use), fp16 weights with
  // fp32 input/output.
  standard: {
    file: 'isnet-general-use-fp16.onnx',
    bytes: 88_150_322,
    sha256: 'ec26ae2353cc9cb7a763b2a344bbbcd53275c3c2eb3cfa910bd08726eac2f332'
  },
  // BiRefNet_lite (MIT), deformable convs split per kernel row and
  // Concat/Split fan-out capped so it fits WebGPU's storage buffer limit.
  hq: {
    file: 'birefnet-lite-webgpu-fp32.onnx',
    bytes: 245_104_408,
    sha256: '34b041d69ccec6a362834c068d638ee451f3e9b236cf5b2ad9bb636d31a4da75'
  }
}

export function modelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

export function modelFile(model: BackgroundModel): string {
  return MODELS[model].file
}

export function modelSize(model: BackgroundModel): number {
  return MODELS[model].bytes
}

// A model is installed once its file exists: downloads land under a .part
// name and are renamed only after the hash matched.
export function modelInstalled(model: BackgroundModel): boolean {
  return existsSync(join(modelsDir(), MODELS[model].file))
}

type Progress = (received: number, total: number) => void

interface Download {
  controller: AbortController
  listeners: Set<Progress>
  done: Promise<ModelDownloadResult>
}

// One download per model; a second request for the same model waits for the
// first. A download is canceled when every request waiting on it is.
const downloads = new Map<BackgroundModel, Download & { waiting: number }>()
// Canceled downloads still removing their .part file; a new download of the
// same model starts after that, so it never shares the file.
const canceling = new Map<BackgroundModel, Promise<unknown>>()

async function fetchModel(
  model: BackgroundModel,
  download: Download
): Promise<ModelDownloadResult> {
  const { file, bytes, sha256 } = MODELS[model]
  const target = join(modelsDir(), file)
  const part = `${target}.part`
  const started = Date.now()
  try {
    await fs.mkdir(modelsDir(), { recursive: true })
    const response = await net.fetch(`${RELEASE_URL}/${file}`, {
      signal: download.controller.signal
    })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get('content-length')) || bytes
    const hash = createHash('sha256')
    let received = 0
    let reported = 0
    // pipeline handles backpressure and rejects on a write error (disk full),
    // which a bare stream would throw outside this try.
    await pipeline(
      response.body as unknown as AsyncIterable<Uint8Array>,
      async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          hash.update(chunk)
          received += chunk.byteLength
          // About every 1%, not on each 64 KB chunk.
          if (received - reported > total / 100 || received === total) {
            reported = received
            for (const listener of download.listeners) listener(received, total)
          }
          yield chunk
        }
      },
      createWriteStream(part)
    )
    const digest = hash.digest('hex')
    if (digest !== sha256) throw new Error(`SHA-256 mismatch: got ${digest}, ${received} bytes`)
    await fs.rename(part, target)
    log.info(`downloaded ${file} (${received} bytes) in ${Date.now() - started} ms`)
    return 'done'
  } catch (error) {
    await fs.rm(part, { force: true }).catch(() => undefined)
    if (download.controller.signal.aborted) {
      log.info(`download of ${file} canceled`)
      return 'canceled'
    }
    log.warn(`download of ${file} failed: ${(error as Error).message}`)
    return 'failed'
  }
}

export function downloadModel(
  model: BackgroundModel,
  onProgress: Progress,
  signal: AbortSignal
): Promise<ModelDownloadResult> {
  if (modelInstalled(model)) return Promise.resolve('done')
  let download = downloads.get(model)
  if (!download) {
    const created = {
      controller: new AbortController(),
      listeners: new Set<Progress>(),
      waiting: 0
    } as Download & { waiting: number }
    const previous = canceling.get(model) ?? Promise.resolve()
    created.done = previous
      .then(() => fetchModel(model, created))
      .finally(() => {
        if (downloads.get(model) === created) downloads.delete(model)
      })
    downloads.set(model, created)
    download = created
  }
  const current = download
  current.waiting++
  current.listeners.add(onProgress)
  return new Promise((resolve) => {
    const leave = (): void => {
      current.listeners.delete(onProgress)
      signal.removeEventListener('abort', cancel)
    }
    const cancel = (): void => {
      leave()
      if (--current.waiting === 0) {
        // A retry right away starts a new download instead of joining this one.
        if (downloads.get(model) === current) downloads.delete(model)
        canceling.set(model, current.done)
        void current.done.finally(() => {
          if (canceling.get(model) === current.done) canceling.delete(model)
        })
        current.controller.abort()
      }
      resolve('canceled')
    }
    if (signal.aborted) return cancel()
    signal.addEventListener('abort', cancel, { once: true })
    void current.done.then((result) => {
      if (signal.aborted) return
      leave()
      resolve(result)
    })
  })
}

app.on('will-quit', () => {
  for (const { controller } of downloads.values()) controller.abort()
})
