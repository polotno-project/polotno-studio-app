import type { BackgroundHostApi } from '../../../preload/background-host'
import type { HostJob, HostResult } from '../../../shared/background-host'

// The hidden background removal page (src/main/background-host.ts): passes
// main's jobs to the worker, one at a time, and the answers back.

declare global {
  interface Window {
    backgroundHost: BackgroundHostApi
  }
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const waiting = new Map<string, (result: HostResult) => void>()

worker.onmessage = ({ data }: MessageEvent<HostResult>) => {
  waiting.get(data.id)?.(data)
  waiting.delete(data.id)
}

// A crashed worker answers nothing: fail what waits, so main isn't left
// waiting for its timeout.
worker.onerror = (event) => {
  console.error('background removal worker failed', event.message ?? event)
  for (const [id, resolve] of waiting) {
    resolve({ id, result: { state: 'failed' }, detail: `worker error: ${event.message}` })
  }
  waiting.clear()
}

let queue: Promise<unknown> = Promise.resolve()

window.backgroundHost.onJob((job: HostJob) => {
  queue = queue.then(async () => {
    const result = await new Promise<HostResult>((resolve) => {
      waiting.set(job.id, resolve)
      worker.postMessage(job, [job.image.buffer])
    })
    window.backgroundHost.result(result)
  })
})

window.backgroundHost.ready()
