import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'
import logger from 'electron-log/main'
import type { BackgroundModel, RemoveBackgroundResult } from '../shared/ipc-contract'
import type { HostJob, HostResult } from '../shared/background-host'
import { modelFile, modelInstalled, modelsDir } from './background-models'

// Background removal with our ONNX models (IS-Net, BiRefNet) runs in a hidden
// window, not in the editor page:
// - The page is served from polotno-bg:// with COOP/COEP, so it is
//   cross-origin isolated and onnxruntime-web's WASM fallback gets threads
//   (4x faster than one thread). The editor page stays on file:// (the
//   Polotno key needs it) and keeps loading cross-origin images freely.
// - Models load from userData/models through the same scheme.
// - Closing the window frees the GPU memory for sure (BiRefNet takes
//   4-6 GB), and a GPU or renderer crash here doesn't take the editor along.
// The page and its worker: src/renderer/background-host.html.

const log = logger.create({ logId: 'background-host' })
log.transports.file.fileName = 'remove-background.log'

const SCHEME = 'polotno-bg'
const ORIGIN = `${SCHEME}://host`
const PARTITION = 'background-host'

// The window stays for the next image a while, unless it held BiRefNet.
const IDLE_MS = 60_000
// A first run on the WASM fallback of a slow machine takes tens of seconds;
// this only catches a stuck page.
const TIMEOUT_MS = 180_000

// Before app ready, and after initSentry: Sentry registers its own scheme
// and merges later registrations into it.
export function registerBackgroundHostScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
  '.onnx': 'application/octet-stream'
}

const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin'
}

async function serveFile(request: Request): Promise<Response> {
  const { pathname, search } = new URL(request.url)
  const path = decodeURIComponent(pathname)
  if (path.startsWith('/models/')) {
    const file = path.slice('/models/'.length)
    const model = (['standard', 'hq'] as const).find((m) => modelFile(m) === file)
    if (!model || !modelInstalled(model)) return new Response('not found', { status: 404 })
    const response = await net.fetch(pathToFileURL(join(modelsDir(), file)).toString())
    return new Response(response.body, {
      headers: { ...ISOLATION, 'Content-Type': TYPES['.onnx'] }
    })
  }
  // Dev: the page comes from the Vite dev server, with the same headers.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    // Vite picks what to serve by the query (`?worker_file`, `?url`) and the
    // Accept header.
    const accept = request.headers.get('accept')
    const response = await net.fetch(
      `${process.env['ELECTRON_RENDERER_URL']}${pathname}${search}`,
      {
        headers: accept ? { accept } : {}
      }
    )
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
  const root = join(__dirname, '../renderer')
  const file = normalize(join(root, path))
  if (!file.startsWith(root + sep)) return new Response('not found', { status: 404 })
  try {
    return new Response(await readFile(file), {
      headers: { ...ISOLATION, 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' }
    })
  } catch {
    return new Response('not found', { status: 404 })
  }
}

async function serve(request: Request): Promise<Response> {
  try {
    return await serveFile(request)
  } catch (error) {
    log.warn(`serving ${request.url} failed: ${(error as Error).message}`)
    return new Response('error', { status: 500 })
  }
}

let protocolReady = false

function hostSession(): Electron.Session {
  const hostSession = session.fromPartition(PARTITION)
  if (!protocolReady) {
    hostSession.protocol.handle(SCHEME, serve)
    // Nothing on this page needs the network, a camera or the like.
    hostSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    )
    protocolReady = true
  }
  return hostSession
}

interface Pending {
  model: BackgroundModel
  resolve: (result: RemoveBackgroundResult) => void
  timer: NodeJS.Timeout
  started: number
}

let host: BrowserWindow | null = null
let ready: Promise<void> | null = null
let abandonReady: (() => void) | undefined
let idleTimer: NodeJS.Timeout | undefined
const pending = new Map<string, Pending>()

function settle(id: string, result: RemoveBackgroundResult, detail: string): void {
  const job = pending.get(id)
  if (!job) return
  pending.delete(id)
  clearTimeout(job.timer)
  const line = `${job.model}: ${result.state} in ${Date.now() - job.started} ms ${detail}`.trim()
  if (result.state === 'done' || result.state === 'canceled') log.info(line)
  else log.warn(line)
  job.resolve(result)
}

// Fails every running job and closes the window.
function closeHost(
  reason: string,
  result: (model: BackgroundModel) => RemoveBackgroundResult
): void {
  clearTimeout(idleTimer)
  for (const [id, job] of pending) settle(id, result(job.model), reason)
  const window = host
  host = null
  ready = null
  abandonReady?.()
  if (window && !window.isDestroyed()) window.destroy()
}

function openHost(): Promise<void> {
  if (ready) return ready
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      session: hostSession(),
      preload: join(__dirname, '../preload/background-host.js'),
      sandbox: true,
      contextIsolation: true,
      // Hidden windows are throttled otherwise.
      backgroundThrottling: false
    }
  })
  host = window
  window.webContents.on('render-process-gone', (_event, details) => {
    if (host !== window) return
    closeHost(`page gone: ${details.reason}`, (model) => ({
      state: model === 'hq' ? 'gpuMemory' : 'failed'
    }))
  })
  // The page's own warnings and errors (onnxruntime's included) go to the log.
  window.webContents.on('console-message', ({ level, message }) => {
    // (In dev, Vite's client can't reach its server from this scheme.)
    if (is.dev && message.includes('ws://')) return
    if (level === 'warning' || level === 'error') {
      log.warn(`page ${level}: ${message.slice(0, 1000)}`)
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  ready = new Promise<void>((resolve, reject) => {
    const onReady = (event: Electron.IpcMainEvent): void => {
      if (event.sender !== window.webContents) return
      ipcMain.removeListener('background-host:ready', onReady)
      abandonReady = undefined
      resolve()
    }
    ipcMain.on('background-host:ready', onReady)
    abandonReady = (): void => {
      ipcMain.removeListener('background-host:ready', onReady)
      abandonReady = undefined
      reject(new Error('closed'))
    }
    window.loadURL(`${ORIGIN}/background-host.html`).catch((error: Error) => {
      if (host === window) closeHost(`load failed: ${error.message}`, () => ({ state: 'failed' }))
    })
  })
  return ready
}

ipcMain.on('background-host:result', (event, { id, result, detail }: HostResult) => {
  if (!host || event.sender !== host.webContents) return
  const job = pending.get(id)
  if (!job) return
  if (result.state === 'done') {
    const dataUrl = `data:image/png;base64,${Buffer.from(result.png).toString('base64')}`
    settle(id, { state: 'done', dataUrl }, detail)
  } else {
    settle(id, result, detail)
  }
  if (pending.size > 0) return
  // After a failure start the next job on a fresh page (the worker may be
  // dead, the GPU device lost).
  if (result.state === 'failed')
    return closeHost('reset after a failure', () => ({ state: 'failed' }))
  // BiRefNet holds gigabytes of GPU memory: let it go right away.
  if (job.model === 'hq') return closeHost('released after hq', () => ({ state: 'failed' }))
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => closeHost('idle', () => ({ state: 'failed' })), IDLE_MS)
})

export async function runBackgroundModel(
  id: string,
  model: BackgroundModel,
  image: Uint8Array
): Promise<RemoveBackgroundResult> {
  if (!modelInstalled(model)) return { state: 'failed' }
  clearTimeout(idleTimer)
  const result = new Promise<RemoveBackgroundResult>((resolve) => {
    const timer = setTimeout(() => {
      // A job can't be interrupted inside onnxruntime: drop the whole page.
      closeHost(`timed out after ${TIMEOUT_MS} ms`, () => ({ state: 'failed' }))
    }, TIMEOUT_MS)
    pending.set(id, { model, resolve, timer, started: Date.now() })
  })
  try {
    await openHost()
  } catch {
    return result
  }
  const job: HostJob = { id, model, modelUrl: `${ORIGIN}/models/${modelFile(model)}`, image }
  host?.webContents.send('background-host:job', job)
  return result
}

// onnxruntime can't stop a run halfway, so canceling closes the page (the
// next job opens a fresh one).
export function cancelBackgroundModel(id: string): boolean {
  if (!pending.has(id)) return false
  settle(id, { state: 'canceled' }, '')
  closeHost('another job was canceled', () => ({ state: 'failed' }))
  return true
}

// The GPU process going down takes WebGPU with it: most likely BiRefNet ran
// out of memory.
app.on('child-process-gone', (_event, details) => {
  if (details.type !== 'GPU' || pending.size === 0) return
  closeHost(`GPU process gone: ${details.reason}`, (model) => ({
    state: model === 'hq' ? 'gpuMemory' : 'failed'
  }))
})

export function closeBackgroundHost(): void {
  closeHost('editor closed', () => ({ state: 'canceled' }))
}

export function isBackgroundHost(window: BrowserWindow): boolean {
  return window === host
}
