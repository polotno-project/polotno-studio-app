import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { CodexEntry, CodexEvent, CodexStatus } from '../../shared/codex'
import type { DocId } from '../../shared/types'
import { getMcpStatus } from '../mcp/launcher'
import { AppServer } from './app-server'

// In-app generation through the user's own Codex install: spawns
// `codex app-server`, signs in with their ChatGPT account (Codex owns the
// login and the tokens; we never see them), and runs one Codex conversation
// per design tab. Codex edits the design through our own MCP server, injected
// per conversation, so its changes land live and share the undo stack.

let server: AppServer | null = null
let starting: Promise<AppServer | null> | null = null
let status: CodexStatus = { state: 'starting' }
let version: string | null = null

const threadByDoc = new Map<DocId, string>()
const docByThread = new Map<string, DocId>()
const turnByThread = new Map<string, string>()
const messageText = new Map<string, string>()
// Designs with a run in flight, claimed before the first await so a double
// submit cannot start two turns on one design.
const busy = new Set<DocId>()
// Stop pressed before turn/start answered: interrupt as soon as the id is known.
const stopRequested = new Set<DocId>()

function finishRun(docId: DocId): void {
  busy.delete(docId)
  stopRequested.delete(docId)
  emit({ type: 'turn', docId, state: 'idle' })
}

function emit(event: CodexEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('codex:event', event)
}

function setStatus(next: CodexStatus): void {
  status = next
  emit({ type: 'status', status })
}

function entry(threadId: string, value: CodexEntry): void {
  const docId = docByThread.get(threadId)
  if (docId) emit({ type: 'entry', docId, entry: value })
}

// --- finding the binary -----------------------------------------------------

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

// GUI apps on macOS don't inherit the shell PATH, so ask the user's login
// shell where codex is, then fall back to the usual install locations.
function fromLoginShell(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  const shellPath = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shellPath, ['-ilc', 'command -v codex'], { timeout: 5000 }, (error, stdout) => {
      const line = stdout.trim().split('\n').pop()?.trim()
      resolve(!error && line?.startsWith('/') ? line : null)
    })
  })
}

async function findCodex(): Promise<string | null> {
  const candidates = [
    process.env.POLOTNO_CODEX_BIN,
    await fromLoginShell(),
    ...(process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, 'codex')),
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    join(homedir(), '.local/bin/codex'),
    join(homedir(), '.npm-global/bin/codex')
  ]
  for (const candidate of candidates) {
    if (candidate && (await isExecutable(candidate))) return candidate
  }
  return null
}

// --- server lifecycle -------------------------------------------------------

async function readAccount(codex: AppServer): Promise<void> {
  const result = await codex.request<{
    account: { type: string; email?: string | null; planType?: string } | null
    requiresOpenaiAuth: boolean
  }>('account/read', { refreshToken: false })
  if (!result.account && result.requiresOpenaiAuth) {
    setStatus({ state: 'signedOut' })
    return
  }
  setStatus({
    state: 'ready',
    email: result.account?.email ?? null,
    plan: result.account?.planType ?? null,
    version
  })
}

async function start(): Promise<AppServer | null> {
  setStatus({ state: 'starting' })
  const binary = await findCodex()
  if (!binary) {
    setStatus({ state: 'missing' })
    return null
  }
  // npm installs of codex are node scripts: keep the binary's dir on PATH.
  const env = { ...process.env, PATH: [dirname(binary), process.env.PATH].join(delimiter) }
  const codex = new AppServer(binary, env, {
    onNotification,
    onRequest,
    onExit: () => {
      if (server !== codex && server !== null) return
      server = null
      for (const docId of [...busy]) finishRun(docId)
      threadByDoc.clear()
      docByThread.clear()
      turnByThread.clear()
      if (status.state !== 'missing') setStatus({ state: 'error', message: 'Codex stopped.' })
    }
  })
  try {
    const init = await codex.request<{ userAgent?: string }>('initialize', {
      clientInfo: { name: 'polotno_app', title: 'Polotno', version: app.getVersion() }
    })
    codex.notify('initialized', {})
    version = /\/(\d+\.\d+\.\d+)/.exec(init.userAgent ?? '')?.[1] ?? null
    server = codex
    await readAccount(codex)
    return codex
  } catch (error) {
    codex.stop()
    setStatus({ state: 'error', message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

function refreshAccount(): void {
  if (!server) return
  readAccount(server).catch((error: Error) => setStatus({ state: 'error', message: error.message }))
}

function ensureServer(): Promise<AppServer | null> {
  if (server) return Promise.resolve(server)
  starting ??= start().finally(() => {
    starting = null
  })
  return starting
}

// --- protocol -> panel ------------------------------------------------------

type Item = {
  id: string
  type: string
  text?: string
  tool?: string
  server?: string
  status?: string
  error?: { message?: string } | null
  savedPath?: string
  revisedPrompt?: string | null
  command?: string
}

function previewOf(path: string | undefined): string | undefined {
  if (!path) return undefined
  const image = nativeImage.createFromPath(path)
  return image.isEmpty() ? undefined : image.resize({ width: 320 }).toDataURL()
}

function onItem(threadId: string, item: Item, completed: boolean): void {
  switch (item.type) {
    case 'agentMessage': {
      const text = completed ? (item.text ?? '') : (messageText.get(item.id) ?? '')
      if (completed) messageText.delete(item.id)
      entry(threadId, { kind: 'message', id: item.id, text, done: completed })
      return
    }
    case 'mcpToolCall':
      entry(threadId, {
        kind: 'tool',
        id: item.id,
        tool: item.server === 'polotno' ? (item.tool ?? 'tool') : `${item.server}.${item.tool}`,
        status: !completed ? 'running' : item.status === 'failed' ? 'failed' : 'done',
        error: item.error?.message
      })
      return
    case 'commandExecution':
      entry(threadId, {
        kind: 'tool',
        id: item.id,
        tool: 'shell',
        status: !completed ? 'running' : item.status === 'completed' ? 'done' : 'failed'
      })
      return
    case 'imageGeneration':
      entry(threadId, {
        kind: 'image',
        id: item.id,
        status: !completed ? 'running' : item.status === 'failed' ? 'failed' : 'done',
        preview: completed ? previewOf(item.savedPath) : undefined,
        prompt: item.revisedPrompt ?? undefined
      })
      return
  }
}

function onNotification(method: string, params: Record<string, unknown>): void {
  const threadId = params.threadId as string | undefined
  switch (method) {
    case 'item/started':
    case 'item/completed':
      if (threadId) onItem(threadId, params.item as Item, method === 'item/completed')
      return
    case 'item/agentMessage/delta': {
      const itemId = params.itemId as string
      const text = (messageText.get(itemId) ?? '') + (params.delta as string)
      messageText.set(itemId, text)
      if (threadId) entry(threadId, { kind: 'message', id: itemId, text, done: false })
      return
    }
    case 'turn/started': {
      const turn = params.turn as { id: string }
      if (threadId) turnByThread.set(threadId, turn.id)
      return
    }
    case 'turn/completed': {
      const turn = params.turn as {
        id: string
        status: string
        error?: { message?: string } | null
      }
      if (!threadId) return
      turnByThread.delete(threadId)
      if (turn.status === 'interrupted') {
        entry(threadId, { kind: 'message', id: `${turn.id}-stopped`, text: 'Stopped.', done: true })
      }
      if (turn.status === 'failed') {
        entry(threadId, {
          kind: 'error',
          id: `${turn.id}-error`,
          text: turn.error?.message ?? 'Codex could not finish.'
        })
      }
      const docId = docByThread.get(threadId)
      if (docId) finishRun(docId)
      return
    }
    case 'account/login/completed':
      // Keep a failure on screen; re-reading the account would replace it
      // with a plain "signed out".
      if (!params.success) {
        setStatus({ state: 'error', message: String(params.error ?? 'Sign-in failed.') })
      } else {
        refreshAccount()
      }
      return
    case 'account/updated':
      if (status.state !== 'error') refreshAccount()
      return
  }
}

// The thread runs with approvalPolicy "never", so these should not arrive;
// answer anything that does with a refusal rather than leaving a turn hanging.
async function onRequest(method: string): Promise<unknown> {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null }
    default:
      throw new Error(`${method} is not supported by Polotno`)
  }
}

// --- public API (IPC) -------------------------------------------------------

function instructions(docId: DocId): string {
  return `You are the AI designer built into the Polotno desktop editor. The user is
looking at the design with designId "${docId}". Make every change to that
design with the polotno MCP tools; do not create other designs unless asked.

- Read the resource polotno://skill/SKILL.md once before your first edit.
- For imagery, use your image generation tool, then put the saved file on the
  page with place_image (absolute path). Do not copy or convert the file.
- Check your work with render_page and lint_design and fix what they show.
- Reply in one or two short sentences: what you changed. No markdown headings.`
}

// Codex features a design conversation must not have. With these off, the
// polotno MCP tools and image generation are the whole toolbox: no shell or
// file viewer that could read the user's files on behalf of a prompt that
// arrived inside a design, no web, browser, connectors, or plugins. (Codex's
// own `exec` stays: it only chains these tools and has no file access.)
const DISABLED_FEATURES = [
  'shell_tool',
  'unified_exec',
  'view_image',
  'apps',
  'plugins',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'multi_agent'
]

async function threadConfig(
  codex: AppServer,
  mcp: { url: string; token: string }
): Promise<Record<string, unknown>> {
  // Per-thread config merges into the user's own: switch off every MCP server
  // they configured for themselves, so it never joins a design conversation.
  const { config } = await codex.request<{ config: { mcp_servers?: Record<string, unknown> } }>(
    'config/read',
    {}
  )
  const own = Object.keys(config.mcp_servers ?? {}).filter((name) => name !== 'polotno')
  return {
    mcp_servers: {
      ...Object.fromEntries(own.map((name) => [name, { enabled: false }])),
      polotno: {
        url: mcp.url,
        http_headers: { Authorization: `Bearer ${mcp.token}` },
        default_tools_approval_mode: 'approve',
        tool_timeout_sec: 180
      }
    },
    'features.image_generation': true,
    web_search: 'disabled',
    ...Object.fromEntries(DISABLED_FEATURES.map((feature) => [`features.${feature}`, false]))
  }
}

export async function getCodexStatus(): Promise<CodexStatus> {
  await ensureServer()
  return status
}

export async function signInToCodex(): Promise<void> {
  const codex = await ensureServer()
  if (!codex) return
  const result = await codex.request<{ type: string; authUrl?: string }>('account/login/start', {
    type: 'chatgpt'
  })
  if (result.authUrl) {
    setStatus({ state: 'signingIn' })
    await shell.openExternal(result.authUrl).catch((error: Error) => {
      setStatus({ state: 'error', message: `Could not open the browser: ${error.message}` })
    })
  }
}

export async function runCodex(docId: DocId, prompt: string): Promise<void> {
  if (busy.has(docId)) throw new Error('Codex is already working on this design.')
  busy.add(docId)
  try {
    const codex = await ensureServer()
    if (!codex || status.state !== 'ready') throw new Error('Codex is not ready.')
    const mcp = getMcpStatus()
    if (!mcp.url) throw new Error('The Polotno MCP server is not running.')

    let threadId = threadByDoc.get(docId)
    if (!threadId) {
      const cwd = join(app.getPath('userData'), 'codex-workspace')
      await fs.mkdir(cwd, { recursive: true })
      const result = await codex.request<{ thread: { id: string } }>('thread/start', {
        cwd,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        serviceName: 'polotno_app',
        developerInstructions: instructions(docId),
        config: await threadConfig(codex, { url: mcp.url, token: mcp.token })
      })
      threadId = result.thread.id
      threadByDoc.set(docId, threadId)
      docByThread.set(threadId, docId)
    }

    emit({ type: 'entry', docId, entry: { kind: 'prompt', id: crypto.randomUUID(), text: prompt } })
    emit({ type: 'turn', docId, state: 'running' })
    const { turn } = await codex.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }]
    })
    turnByThread.set(threadId, turn.id)
    if (stopRequested.has(docId)) await stopCodex(docId)
  } catch (error) {
    finishRun(docId)
    throw error
  }
}

export async function stopCodex(docId: DocId): Promise<void> {
  const threadId = threadByDoc.get(docId)
  const turnId = threadId && turnByThread.get(threadId)
  if (server && threadId && turnId) {
    stopRequested.delete(docId)
    await server.request('turn/interrupt', { threadId, turnId })
  } else if (busy.has(docId)) {
    stopRequested.add(docId)
  }
}

// Forget the design's conversation; the next prompt starts a fresh one. A
// run in flight is interrupted first (the tab closed, or the token changed).
export function resetCodex(docId: DocId): void {
  if (busy.has(docId)) void stopCodex(docId).catch(() => undefined)
  const threadId = threadByDoc.get(docId)
  if (!threadId) return
  threadByDoc.delete(docId)
  docByThread.delete(threadId)
  turnByThread.delete(threadId)
  finishRun(docId)
}

// The MCP token was rotated: every conversation still holds the old one in its
// thread config, so all of them start over with the next prompt.
export function resetAllCodex(): void {
  for (const docId of [...threadByDoc.keys()]) {
    const hadThread = threadByDoc.has(docId)
    resetCodex(docId)
    if (hadThread) {
      emit({
        type: 'entry',
        docId,
        entry: {
          kind: 'message',
          id: crypto.randomUUID(),
          text: 'The connection token changed, so the next prompt starts a new conversation.',
          done: true
        }
      })
    }
  }
}

export function shutdownCodex(): void {
  server?.stop()
  server = null
}
