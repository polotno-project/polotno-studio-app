import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import logger from 'electron-log/main'
import type { RemoveBackgroundResult } from '../shared/ipc-contract'

// On-device background removal on macOS 14+: a small Swift helper
// (native/remove-background, built by scripts/build-remove-background.mjs)
// runs Apple Vision's subject lifting. Image bytes go in on stdin, a
// transparent PNG comes out on stdout. Elsewhere the feature is off and the
// renderer hides the Remove background entry.

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

export function removeBackgroundAvailable(): boolean {
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

export function removeBackground(id: string, image: Uint8Array): Promise<RemoveBackgroundResult> {
  if (!removeBackgroundAvailable()) return Promise.resolve({ state: 'failed' })
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

export function cancelRemoveBackground(id: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.canceled = true
  job.child.kill()
}

app.on('will-quit', () => {
  for (const { child } of jobs.values()) child.kill()
})
