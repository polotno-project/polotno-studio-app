import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { CodexEntry, CodexEvent, CodexModels, CodexStatus } from '../../shared/codex'
import type { DocId } from '../../shared/types'
import { getMcpStatus } from '../mcp/launcher'
import { readLocalImage, type LocalImage } from '../../mcp-server/local-image'
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
// Where Codex saved each generated image, by feed entry id. The panel asks
// for an image by entry id, so the renderer never names a file path.
const imageFiles = new Map<string, string>()
// Canvas AI tool requests (Generative fill, Expand) run in their own throwaway
// threads, apart from the design conversation.
type ImageEdit = { turnId?: string; savedPath?: string; finish: (status: string) => void }
const editByThread = new Map<string, ImageEdit>()
const threadByEdit = new Map<string, string>()
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
      if (completed && item.savedPath) imageFiles.set(item.id, item.savedPath)
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
    case 'item/completed': {
      const edit = threadId && editByThread.get(threadId)
      if (edit) {
        const item = params.item as Item
        if (method === 'item/completed' && item.type === 'imageGeneration' && item.savedPath) {
          edit.savedPath = item.savedPath
        }
        return
      }
      if (threadId) onItem(threadId, params.item as Item, method === 'item/completed')
      return
    }
    case 'item/agentMessage/delta': {
      const itemId = params.itemId as string
      const text = (messageText.get(itemId) ?? '') + (params.delta as string)
      messageText.set(itemId, text)
      if (threadId) entry(threadId, { kind: 'message', id: itemId, text, done: false })
      return
    }
    case 'turn/started': {
      const turn = params.turn as { id: string }
      const edit = threadId && editByThread.get(threadId)
      if (edit) edit.turnId = turn.id
      else if (threadId) turnByThread.set(threadId, turn.id)
      return
    }
    case 'turn/completed': {
      const turn = params.turn as {
        id: string
        status: string
        error?: { message?: string } | null
      }
      if (!threadId) return
      const edit = editByThread.get(threadId)
      if (edit) {
        edit.finish(turn.status)
        return
      }
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
- For imagery, use your image generation tool, then always put the saved file
  on the page with place_image (absolute path); a generated image is not in
  the design until you do. For a background use place_image with
  as: "background". Do not copy or convert the file.
- Check your work with render_page and lint_design and fix what they show.
- Reply in one or two short sentences: what you changed. Markdown renders in
  the panel, but the panel is narrow: no headings, keep tables small.
- If you need the user's input, ask and end your turn; their answer arrives as
  the next message. The user may also add messages while you work.`
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

type ModelListEntry = {
  id: string
  displayName: string
  description: string
  hidden: boolean
  isDefault: boolean
}

async function listModels(codex: AppServer): Promise<ModelListEntry[]> {
  const { data } = await codex.request<{ data: ModelListEntry[] }>('model/list', {
    includeHidden: true
  })
  return data
}

// The model picked in the panel, kept across launches. Null: Codex's own choice.
const modelFile = (): string => join(app.getPath('userData'), 'codex-model.json')
let pickedModel: string | null | undefined

async function readPickedModel(): Promise<string | null> {
  if (pickedModel === undefined) {
    try {
      pickedModel = JSON.parse(await fs.readFile(modelFile(), 'utf8')).model ?? null
    } catch {
      pickedModel = null
    }
  }
  return pickedModel ?? null
}

// The picked model, or the one from the user's config.toml, unless their
// account can't use it (a ChatGPT login only serves some models): then
// Codex's default, so the conversation runs instead of failing on its first
// turn.
async function threadModel(codex: AppServer, configured?: string): Promise<string | undefined> {
  const wanted = (await readPickedModel()) ?? configured
  if (!wanted) return undefined
  const data = await listModels(codex)
  if (data.some((model) => model.id === wanted)) return wanted
  return data.find((model) => model.isDefault)?.id
}

export async function getCodexModels(): Promise<CodexModels> {
  const codex = await ensureServer()
  if (!codex || status.state !== 'ready') return { models: [], selected: null }
  const data = await listModels(codex)
  const picked = await readPickedModel()
  return {
    models: data
      .filter((model) => !model.hidden || model.id === picked)
      .map((model) => ({
        id: model.id,
        name: model.displayName,
        description: model.description,
        isDefault: model.isDefault
      })),
    selected: data.some((model) => model.id === picked) ? picked : null
  }
}

// Applies from the next message on, in every design's conversation (turn/start
// carries the model, and Codex keeps it for later turns of that thread).
export async function setCodexModel(model: string | null): Promise<void> {
  pickedModel = model
  await fs.writeFile(modelFile(), JSON.stringify({ model }), 'utf8')
}

async function threadConfig(
  codex: AppServer,
  // Without it the thread gets no MCP servers at all (image edits).
  mcp: { url: string; token: string } | null
): Promise<{ model?: string; config: Record<string, unknown> }> {
  // Per-thread config merges into the user's own: switch off every MCP server
  // they configured for themselves, so it never joins a design conversation.
  const { config } = await codex.request<{
    config: { model?: string; mcp_servers?: Record<string, unknown> }
  }>('config/read', {})
  const own = Object.keys(config.mcp_servers ?? {}).filter((name) => name !== 'polotno')
  return {
    model: await threadModel(codex, config.model),
    config: {
      mcp_servers: {
        ...Object.fromEntries(own.map((name) => [name, { enabled: false }])),
        ...(mcp && {
          polotno: {
            url: mcp.url,
            http_headers: { Authorization: `Bearer ${mcp.token}` },
            default_tools_approval_mode: 'approve',
            tool_timeout_sec: 180
          }
        })
      },
      'features.image_generation': true,
      web_search: 'disabled',
      ...Object.fromEntries(DISABLED_FEATURES.map((feature) => [`features.${feature}`, false]))
    }
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

// A message sent while Codex is working joins the running turn (an answer to
// its question, or a correction) instead of waiting for it to end.
async function steerCodex(docId: DocId, prompt: string): Promise<void> {
  const threadId = threadByDoc.get(docId)
  const turnId = threadId && turnByThread.get(threadId)
  if (!server || !threadId || !turnId) {
    throw new Error('Codex is still starting this request. Send again in a moment.')
  }
  await server.request('turn/steer', {
    threadId,
    expectedTurnId: turnId,
    input: [{ type: 'text', text: prompt }]
  })
  emit({ type: 'entry', docId, entry: { kind: 'prompt', id: crypto.randomUUID(), text: prompt } })
}

export async function runCodex(docId: DocId, prompt: string): Promise<void> {
  if (busy.has(docId)) {
    try {
      return await steerCodex(docId, prompt)
    } catch (error) {
      // The turn ended while the message was on its way: start a new one.
      if (busy.has(docId)) throw error
    }
  }
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
        ...(await threadConfig(codex, { url: mcp.url, token: mcp.token }))
      })
      threadId = result.thread.id
      threadByDoc.set(docId, threadId)
      docByThread.set(threadId, docId)
    }

    emit({ type: 'entry', docId, entry: { kind: 'prompt', id: crypto.randomUUID(), text: prompt } })
    emit({ type: 'turn', docId, state: 'running' })
    // The picked model (if the account still serves it), so a pick made
    // mid-conversation applies from this message on.
    const model = (await readPickedModel()) && (await threadModel(codex))
    const { turn } = await codex.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      ...(model && { model })
    })
    turnByThread.set(threadId, turn.id)
    if (stopRequested.has(docId)) await stopCodex(docId)
  } catch (error) {
    finishRun(docId)
    throw error
  }
}

// The full-size generated image behind a feed entry, for "Add to design".
export async function codexImage(id: string): Promise<LocalImage> {
  const path = imageFiles.get(id)
  if (!path) throw new Error('This image is no longer available.')
  return readLocalImage(path)
}

const EDIT_INSTRUCTIONS = `You are an image editing tool inside a design
editor, not a conversation. Use your image generation tool exactly once to
produce the edited image from the attached one, then reply "done". Never ask
questions. Keep the framing: no zoom, crop, or camera change.`

// One canvas AI edit (Generative fill, Expand). The renderer sends the image
// with the area to change painted solid magenta (image models follow a marked
// area far better than a separate mask), and composites the result back
// itself. Resolves with the generated image as a data URL.
export async function editImageWithCodex(
  id: string,
  png: Uint8Array,
  instruction: string
): Promise<{ dataUrl: string }> {
  const codex = await ensureServer()
  if (!codex || status.state !== 'ready') throw new Error('Codex is not connected.')
  const dir = join(app.getPath('temp'), 'polotno-image-edit')
  await fs.mkdir(dir, { recursive: true })
  const input = join(dir, `${id}.png`)
  await fs.writeFile(input, png)
  try {
    // The image model now and then answers without generating: try twice.
    for (let attempt = 0; attempt < 2; attempt++) {
      const savedPath = await runImageEdit(codex, id, input, instruction)
      if (savedPath) return { dataUrl: (await readLocalImage(savedPath)).dataUrl }
      if (!threadByEdit.has(id)) break
    }
    throw new Error('Codex did not return an image.')
  } finally {
    threadByEdit.delete(id)
    await fs.rm(input, { force: true })
  }
}

async function runImageEdit(
  codex: AppServer,
  id: string,
  input: string,
  instruction: string
): Promise<string | undefined> {
  const cwd = join(app.getPath('userData'), 'codex-workspace')
  await fs.mkdir(cwd, { recursive: true })
  const { thread } = await codex.request<{ thread: { id: string } }>('thread/start', {
    cwd,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    ephemeral: true,
    serviceName: 'polotno_app',
    developerInstructions: EDIT_INSTRUCTIONS,
    ...(await threadConfig(codex, null))
  })
  let finish!: (status: string) => void
  const done = new Promise<string>((resolve) => (finish = resolve))
  const edit: ImageEdit = { finish }
  editByThread.set(thread.id, edit)
  threadByEdit.set(id, thread.id)
  try {
    const { turn } = await codex.request<{ turn: { id: string } }>('turn/start', {
      threadId: thread.id,
      input: [
        { type: 'text', text: instruction },
        { type: 'localImage', path: input }
      ]
    })
    edit.turnId ??= turn.id
    const result = await done
    if (result === 'interrupted') throw Object.assign(new Error('Canceled'), { name: 'AbortError' })
    if (result === 'failed' && !edit.savedPath) throw new Error('Codex could not edit the image.')
    return edit.savedPath
  } finally {
    editByThread.delete(thread.id)
    void codex.request('thread/unsubscribe', { threadId: thread.id }).catch(() => undefined)
  }
}

export async function cancelImageEdit(id: string): Promise<void> {
  const threadId = threadByEdit.get(id)
  threadByEdit.delete(id)
  const turnId = threadId && editByThread.get(threadId)?.turnId
  if (server && threadId && turnId) await server.request('turn/interrupt', { threadId, turnId })
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
