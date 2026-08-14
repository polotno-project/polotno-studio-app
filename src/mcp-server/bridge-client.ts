import { randomUUID } from 'node:crypto'
import type { ChildToMain, MainToChild, RpcMethod, RpcRequestMap } from '../shared/mcp-rpc'

// Promise-correlated RPC from the utilityProcess to main over parentPort.

const RPC_TIMEOUT_MS = 60_000

interface ParentPort {
  on(event: 'message', listener: (event: { data: MainToChild }) => void): void
  postMessage(message: ChildToMain): void
}

const parentPort = (process as unknown as { parentPort: ParentPort }).parentPort

const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()

parentPort.on('message', ({ data }) => {
  if (data.type !== 'rpc-result') return
  const entry = pending.get(data.id)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(data.id)
  if (data.ok) entry.resolve(data.result)
  else entry.reject(new Error(data.error ?? 'RPC failed'))
})

export function rpc<M extends RpcMethod>(
  method: M,
  params: RpcRequestMap[M]['params']
): Promise<RpcRequestMap[M]['result']> {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`RPC ${method} timed out`))
    }, RPC_TIMEOUT_MS)
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
    parentPort.postMessage({ type: 'rpc', id, method, params })
  })
}

export function announceListening(url: string): void {
  parentPort.postMessage({ type: 'listening', url })
}
