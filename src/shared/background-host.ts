import type { BackgroundModel } from './ipc-contract'

// Messages between main and the hidden background removal page
// (src/main/background-host.ts, src/renderer/background-host.html).

export interface HostJob {
  id: string
  model: BackgroundModel
  modelUrl: string
  image: Uint8Array
}

export type HostOutcome =
  | { state: 'done'; png: Uint8Array }
  | { state: 'noSubject' }
  | { state: 'unreadable' }
  | { state: 'failed' }
  | { state: 'gpuMemory' }

export interface HostResult {
  id: string
  result: HostOutcome
  // For the log: backend, timings, the error.
  detail: string
}
