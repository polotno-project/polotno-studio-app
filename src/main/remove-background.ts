import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import logger from 'electron-log/main'
import type {
  BackgroundModel,
  ModelDownloadResult,
  RemoveBackgroundEngine,
  RemoveBackgroundEngines,
  RemoveBackgroundQuality,
  RemoveBackgroundResult
} from '../shared/ipc-contract'
import { cancelBackgroundModel, runBackgroundModel } from './background-host'
import { downloadModel, modelInstalled, modelSize } from './background-models'

// On-device background removal, three engines:
// - vision: on macOS 14+, a small Swift helper (native/remove-background,
//   built by scripts/build-remove-background.mjs) runs Apple Vision's subject
//   lifting. Image bytes go in on stdin, a transparent PNG comes out on
//   stdout.
// - standard: IS-Net, where Vision isn't available.
// - hq: BiRefNet, heavier and better, when the person asks for it.
// standard and hq run in a hidden page (background-host.ts) on models
// downloaded on first use (background-models.ts).

// ~/Library/Logs/polotno-app/remove-background.log
const log = logger.create({ logId: 'remove-background' })
log.transports.file.fileName = 'remove-background.log'

// Vision takes 0.2–0.5 s on a 2k image; this only catches a stuck helper.
const TIMEOUT_MS = 30_000

// The helper's exit codes (native/remove-background/main.swift).
const EXIT_NO_SUBJECT = 3
const EXIT_UNREADABLE = 4

// POLOTNO_REMOVE_BACKGROUND_HELPER points at another binary, or at a missing
// one to try the app without the feature.
function helperPath(): string {
  return (
    process.env.POLOTNO_REMOVE_BACKGROUND_HELPER ??
    (is.dev
      ? join(app.getAppPath(), 'out/helpers/remove-background')
      : join(process.resourcesPath, 'helpers/remove-background'))
  )
}

let available: boolean | undefined

function visionAvailable(): boolean {
  if (available !== undefined) return available
  const macos = process.platform === 'darwin' ? process.getSystemVersion() : null
  if (!macos || Number(macos.split('.')[0]) < 14) {
    available = false
  } else {
    available = existsSync(helperPath())
    if (!available) log.warn(`helper missing at ${helperPath()}`)
  }
  return available
}

const jobs = new Map<string, { child: ChildProcess; canceled: boolean }>()

function runVision(id: string, image: Uint8Array): Promise<RemoveBackgroundResult> {
  if (!visionAvailable()) return Promise.resolve({ state: 'failed' })
  const started = Date.now()
  const child = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'pipe'] })
  const job = { child, canceled: false }
  jobs.set(id, job)

  return new Promise((resolve) => {
    const output: Buffer[] = []
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    // The helper exits early on unreadable input, before reading it all.
    child.stdin.on('error', () => undefined)
    child.stdin.end(image)

    let finished = false
    // A spawn failure fires both 'error' and 'close'.
    const finish = (result: RemoveBackgroundResult, detail: string): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      jobs.delete(id)
      const line = `${result.state} in ${Date.now() - started} ms, ${image.byteLength} bytes in: ${detail.trim()}`
      if (result.state === 'done' || result.state === 'canceled') log.info(line)
      else log.warn(line)
      resolve(result)
    }

    child.on('error', (error) => finish({ state: 'failed' }, error.message))
    child.on('close', (code, signal) => {
      if (job.canceled) return finish({ state: 'canceled' }, 'canceled')
      if (timedOut) return finish({ state: 'failed' }, `timed out after ${TIMEOUT_MS} ms`)
      if (code === 0) {
        const png = Buffer.concat(output)
        return finish(
          { state: 'done', dataUrl: `data:image/png;base64,${png.toString('base64')}` },
          stderr
        )
      }
      if (code === EXIT_NO_SUBJECT) return finish({ state: 'noSubject' }, stderr)
      if (code === EXIT_UNREADABLE) return finish({ state: 'unreadable' }, stderr)
      finish({ state: 'failed' }, `exit ${code ?? signal}: ${stderr}`)
    })
  })
}

// BiRefNet takes 4.5 GB of GPU memory at best. On Apple Silicon that is
// system memory, so below 16 GB precise mode isn't offered. Discrete GPUs
// don't say how much memory they have: a run that runs out says so.
const HQ_MIN_UNIFIED_MEMORY = 15.5 * 2 ** 30

function hqAllowed(): boolean {
  return process.platform !== 'darwin' || totalmem() >= HQ_MIN_UNIFIED_MEMORY
}

// userData/remove-background.json: { "quality": "standard" | "high" }
function settingsPath(): string {
  return join(app.getPath('userData'), 'remove-background.json')
}

let quality: RemoveBackgroundQuality | undefined
let webgpu = false
const qualityListeners = new Set<() => void>()

async function loadQuality(): Promise<RemoveBackgroundQuality> {
  if (quality) return quality
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    quality = parsed.quality === 'high' ? 'high' : 'standard'
  } catch {
    quality = 'standard'
  }
  return quality
}

export async function setRemoveBackgroundQuality(value: RemoveBackgroundQuality): Promise<void> {
  quality = value
  for (const listener of qualityListeners) listener()
  await fs
    .writeFile(settingsPath(), JSON.stringify({ quality: value }))
    .catch((error) => log.warn(`could not save the quality setting: ${error.message}`))
}

// For the File menu's "Precise Background Removal" item.
export function removeBackgroundQualityMenu(): { visible: boolean; checked: boolean } {
  return { visible: webgpu && hqAllowed(), checked: quality === 'high' }
}

export function onRemoveBackgroundQualityChange(listener: () => void): void {
  qualityListeners.add(listener)
}

// `gpu`: the renderer found a WebGPU adapter that isn't a software fallback.
export async function removeBackgroundEngines(gpu: boolean): Promise<RemoveBackgroundEngines> {
  const changed = webgpu !== gpu
  webgpu = gpu
  await loadQuality()
  if (changed) for (const listener of qualityListeners) listener()
  return {
    vision: visionAvailable(),
    hq: hqAllowed(),
    quality: quality ?? 'standard',
    installed: { standard: modelInstalled('standard'), hq: modelInstalled('hq') },
    sizes: { standard: modelSize('standard'), hq: modelSize('hq') }
  }
}

const downloads = new Map<string, AbortController>()

export async function downloadBackgroundModel(
  id: string,
  model: BackgroundModel,
  onProgress: (received: number, total: number) => void
): Promise<ModelDownloadResult> {
  const controller = new AbortController()
  downloads.set(id, controller)
  try {
    return await downloadModel(model, onProgress, controller.signal)
  } finally {
    downloads.delete(id)
  }
}

export function removeBackground(
  id: string,
  image: Uint8Array,
  engine: RemoveBackgroundEngine
): Promise<RemoveBackgroundResult> {
  if (engine === 'vision') return runVision(id, image)
  if (engine === 'hq' && !hqAllowed()) return Promise.resolve({ state: 'failed' })
  return runBackgroundModel(id, engine, image)
}

export function cancelRemoveBackground(id: string): void {
  downloads.get(id)?.abort()
  if (cancelBackgroundModel(id)) return
  const job = jobs.get(id)
  if (!job) return
  job.canceled = true
  job.child.kill()
}

app.on('will-quit', () => {
  for (const { child } of jobs.values()) child.kill()
})
