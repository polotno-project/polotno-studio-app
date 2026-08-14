import { randomUUID } from 'node:crypto'
import { ipcMain, webContents, type WebContents } from 'electron'
import type { BridgeResponse } from '../shared/bridge-protocol'
import {
  MUTATING_COMMANDS,
  type AppCommand,
  type BridgeCommand,
  type CommandResult,
  type DesignCommand
} from '../shared/commands'
import type { DocId } from '../shared/types'
import { documents } from './documents'
import { getEditorWindow } from './window'

// Main is a pure message router: it correlates responses by id and routes by
// docId, never interpreting commands. The MCP utilityProcess calls
// execCommand/execAppCommand for every agent operation; a per-design FIFO
// queue keeps multi-step agent edits from interleaving.

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

function sendRequest(
  wc: WebContents,
  docId: DocId,
  command: BridgeCommand,
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const id = randomUUID()
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve({ ok: false, error: { code: 'timeout', message: `Command ${command.type} timed out` } })
    }, timeoutMs)
    pending.set(id, { resolve, timer })
    wc.send('bridge:request', { id, docId, command })
  })
}

export function execCommand(
  docId: DocId,
  command: DesignCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  const run = (): Promise<CommandResult> => {
    const entry = documents.get(docId)
    if (!entry) {
      return Promise.resolve({
        ok: false,
        error: { code: 'document_not_found', message: `No document ${docId}` }
      })
    }
    const wc = webContents.fromId(entry.wcId)
    if (!wc || wc.isDestroyed()) {
      return Promise.resolve({
        ok: false,
        error: { code: 'document_not_found', message: 'The hosting window is gone' }
      })
    }
    return sendRequest(wc, docId, command, timeoutMs)
  }

  const prev = queues.get(docId) ?? Promise.resolve<CommandResult>({ ok: true })
  const next = prev.then(run, run).then((result) => {
    const entry = documents.get(docId)
    if (entry && result.ok && MUTATING_COMMANDS.has(command.type)) entry.rev++
    return entry && result.ok ? { ...result, rev: entry.rev } : result
  })
  queues.set(docId, next)
  return next
}

// Tab-level operations target the editor window itself (docId '').
export function execAppCommand(
  command: AppCommand,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<CommandResult> {
  const win = getEditorWindow()
  if (!win || win.isDestroyed()) {
    return Promise.resolve({
      ok: false,
      error: { code: 'document_not_found', message: 'The editor window is not open' }
    })
  }
  return sendRequest(win.webContents, '', command, timeoutMs)
}
