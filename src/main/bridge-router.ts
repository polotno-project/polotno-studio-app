import { randomUUID } from 'node:crypto'
import { ipcMain, webContents } from 'electron'
import type { BridgeResponse } from '../shared/bridge-protocol'
import type { DesignCommand, CommandResult } from '../shared/commands'
import type { DocId } from '../shared/types'
import { documents } from './documents'

// Main is a pure message router: it correlates responses by id and routes by
// docId, never interpreting commands. Stage 2's MCP utilityProcess calls
// execCommand for every agent edit; a per-design FIFO queue keeps multi-step
// agent edits from interleaving.

const DEFAULT_TIMEOUT_MS = 30_000

const pending = new Map<string, { resolve: (result: CommandResult) => void; timer: NodeJS.Timeout }>()
const queues = new Map<DocId, Promise<CommandResult>>()

export function initBridgeRouter(): void {
  ipcMain.on('bridge:response', (_event, response: BridgeResponse) => {
    const entry = pending.get(response.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(response.id)
    entry.resolve(response.result)
  })
}

export function execCommand(
  docId: DocId,
  command: DesignCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  const run = (): Promise<CommandResult> =>
    new Promise((resolve) => {
      const entry = documents.get(docId)
      if (!entry) {
        resolve({ ok: false, error: { code: 'document_not_found', message: `No document ${docId}` } })
        return
      }
      const wc = webContents.fromId(entry.wcId)
      if (!wc || wc.isDestroyed()) {
        resolve({
          ok: false,
          error: { code: 'document_not_found', message: 'The hosting window is gone' }
        })
        return
      }
      const id = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({
          ok: false,
          error: { code: 'timeout', message: `Command ${command.type} timed out` }
        })
      }, timeoutMs)
      pending.set(id, { resolve, timer })
      wc.send('bridge:request', { id, docId, command })
    })

  const prev = queues.get(docId) ?? Promise.resolve<CommandResult>({ ok: true })
  const next = prev.then(run, run)
  queues.set(docId, next)
  return next
}
