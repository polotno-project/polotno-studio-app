import { app, utilityProcess, type UtilityProcess } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { ChildToMain, RpcMethod, RpcRequestMap } from '../../shared/mcp-rpc'
import { execCommand, execAppCommand } from '../bridge-router'
import { listRecent } from '../recent'
import {
  cleanStaleDiscovery,
  getMcpToken,
  removeDiscoveryFile,
  writeDiscoveryFile
} from './token'

// Runs the MCP server as a utilityProcess and answers its RPCs by routing
// through the bridge into the live editor. Restarts on crash with a cap so a
// crash loop cannot spin forever.

let child: UtilityProcess | null = null
let currentUrl: string | null = null
let stopping = false
let restarts: number[] = []

export function getMcpStatus(): { running: boolean; url: string | null; token: string } {
  return { running: child !== null && currentUrl !== null, url: currentUrl, token: getMcpToken() }
}

function serverEntryPath(): string {
  return is.dev
    ? join(app.getAppPath(), 'out/mcp-server.cjs')
    : join(process.resourcesPath, 'mcp-server.cjs')
}

async function uniquePath(dir: string, fileName: string): Promise<string> {
  const safe = basename(fileName)
  const dot = safe.lastIndexOf('.')
  const stem = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  for (let i = 0; ; i++) {
    const candidate = join(dir, i === 0 ? safe : `${stem}-${i}${ext}`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
}

async function handleRpc<M extends RpcMethod>(
  method: M,
  params: RpcRequestMap[M]['params']
): Promise<unknown> {
  switch (method) {
    case 'design.exec': {
      const p = params as RpcRequestMap['design.exec']['params']
      return execCommand(p.docId, p.command)
    }
    case 'app.exec': {
      const p = params as RpcRequestMap['app.exec']['params']
      return execAppCommand(p.command)
    }
    case 'designs.list': {
      const open = await execAppCommand({ type: 'list_tabs' })
      return { open: open.ok ? open.value : [], recent: await listRecent() }
    }
    case 'export.write': {
      const p = params as RpcRequestMap['export.write']['params']
      const dir = p.dir ?? app.getPath('downloads')
      await fs.mkdir(dir, { recursive: true })
      const path = await uniquePath(dir, p.fileName)
      await fs.writeFile(path, Buffer.from(p.base64, 'base64'))
      return { path }
    }
    default:
      throw new Error(`Unknown RPC method: ${method}`)
  }
}

export function startMcpServer(): void {
  if (child || stopping) return
  cleanStaleDiscovery()
  const token = getMcpToken()

  child = utilityProcess.fork(serverEntryPath(), [], {
    serviceName: 'polotno-mcp',
    env: {
      ...process.env,
      POLOTNO_MCP_TOKEN: token,
      POLOTNO_MCP_PORT: process.env.POLOTNO_MCP_PORT ?? '41414',
      POLOTNO_APP_VERSION: app.getVersion()
    }
  })

  child.on('message', (message: ChildToMain) => {
    if (message.type === 'listening') {
      currentUrl = message.url
      void writeDiscoveryFile(message.url, token)
      return
    }
    if (message.type === 'rpc') {
      handleRpc(message.method, message.params as never)
        .then((result) =>
          child?.postMessage({ type: 'rpc-result', id: message.id, ok: true, result })
        )
        .catch((error: unknown) =>
          child?.postMessage({
            type: 'rpc-result',
            id: message.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        )
    }
  })

  child.on('exit', (code) => {
    child = null
    currentUrl = null
    if (stopping) return
    console.error(`MCP server exited with code ${code}`)
    const now = Date.now()
    restarts = restarts.filter((t) => now - t < 60_000)
    if (restarts.length < 3) {
      restarts.push(now)
      setTimeout(startMcpServer, 1000 * restarts.length)
    } else {
      console.error('MCP server crashed repeatedly; not restarting')
    }
  })
}

export function stopMcpServer(): void {
  stopping = true
  removeDiscoveryFile()
  child?.kill()
  child = null
}

// Token rotation: kill the child (without triggering crash-restart) and start
// fresh — the new token flows in via env.
export function restartMcpServer(): void {
  const current = child
  child = null
  currentUrl = null
  restarts = []
  if (current) {
    current.removeAllListeners('exit')
    current.kill()
  }
  startMcpServer()
}
