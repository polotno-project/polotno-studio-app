import { app, nativeImage, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import type {
  AgentEntry,
  AgentEvent,
  AgentModels,
  AgentStatus,
  ChatRef
} from '../../../shared/agent'
import { getMcpStatus } from '../../mcp/launcher'
import { readLocalImage, type LocalImage } from '../../../mcp-server/local-image'
import { keepChatImage } from '../chats'
import { CODEX_DISABLED_FEATURES } from '../lockdown'
import { findBinary } from '../find-binary'
import { designInstructions } from '../instructions'
import { emitAgentEvent, PANEL_HIDDEN_TOOLS, type AgentProvider } from '../provider'
import { AppServer } from './app-server'

// In-app generation through the user's own Codex install: spawns
// `codex app-server`, signs in with their ChatGPT account (Codex owns the
// login and the tokens; we never see them), and runs one Codex conversation
// (thread) per chat. Codex edits the design through our own MCP server, injected
// per conversation, so its changes land live and share the undo stack.

let server: AppServer | null = null
let starting: Promise<AppServer | null> | null = null
let status: AgentStatus = { state: 'starting' }
let version: string | null = null

// Each chat's thread, and back.
const threadByChat = new Map<string, string>()
const chatByThread = new Map<string, ChatRef>()
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
// Chats with a run in flight (by chat id), claimed before the first await so
// a double submit cannot start two turns in one chat.
const busy = new Map<string, ChatRef>()
// Stop pressed before turn/start answered: interrupt as soon as the id is known.
const stopRequested = new Set<string>()

function finishRun(chat: ChatRef): void {
  busy.delete(chat.chatId)
  stopRequested.delete(chat.chatId)
  emit({ type: 'turn', ...chat, state: 'idle' })
}

function emit(event: AgentEvent): void {
  emitAgentEvent(event)
}

function setStatus(next: AgentStatus): void {
  status = next
  emit({ type: 'status', agent: 'codex', status })
}

function entry(threadId: string, value: AgentEntry): void {
  const chat = chatByThread.get(threadId)
  if (chat) emit({ type: 'entry', ...chat, entry: value })
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
    plan: result.account?.planType ? `ChatGPT ${result.account.planType}` : null,
    version
  })
}

async function start(): Promise<AppServer | null> {
  setStatus({ state: 'starting' })
  const binary = await findBinary('codex', { envOverride: 'POLOTNO_CODEX_BIN' })
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
      for (const chat of [...busy.values()]) finishRun(chat)
      threadByChat.clear()
      chatByThread.clear()
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
      if (completed && item.savedPath) {
        imageFiles.set(item.id, item.savedPath)
        void keepChatImage(item.id, item.savedPath).catch((error) =>
          console.error('Keeping the generated image failed:', error)
        )
      }
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
      const chat = chatByThread.get(threadId)
      if (chat) finishRun(chat)
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

async function getModels(): Promise<AgentModels> {
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
async function setModel(model: string | null): Promise<void> {
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
            disabled_tools: PANEL_HIDDEN_TOOLS,
            tool_timeout_sec: 180
          }
        })
      },
      'features.image_generation': true,
      web_search: 'disabled',
      ...Object.fromEntries(
        CODEX_DISABLED_FEATURES.map((feature) => [`features.${feature}`, false])
      )
    }
  }
}

export async function getCodexStatus(): Promise<AgentStatus> {
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
async function steer(chat: ChatRef, prompt: string): Promise<void> {
  const threadId = threadByChat.get(chat.chatId)
  const turnId = threadId && turnByThread.get(threadId)
  if (!server || !threadId || !turnId) {
    throw new Error('Codex is still starting this request. Send again in a moment.')
  }
  await server.request('turn/steer', {
    threadId,
    expectedTurnId: turnId,
    input: [{ type: 'text', text: prompt }]
  })
  emit({ type: 'entry', ...chat, entry: { kind: 'prompt', id: crypto.randomUUID(), text: prompt } })
}

async function run(chat: ChatRef, prompt: string, context?: string): Promise<void> {
  if (busy.has(chat.chatId)) {
    try {
      return await steer(chat, prompt)
    } catch (error) {
      // The turn ended while the message was on its way: start a new one.
      if (busy.has(chat.chatId)) throw error
    }
  }
  busy.set(chat.chatId, chat)
  try {
    const codex = await ensureServer()
    if (!codex || status.state !== 'ready') throw new Error('Codex is not ready.')
    const mcp = getMcpStatus()
    if (!mcp.url) throw new Error('The Polotno MCP server is not running.')

    let threadId = threadByChat.get(chat.chatId)
    if (!threadId) {
      const cwd = join(app.getPath('userData'), 'codex-workspace')
      await fs.mkdir(cwd, { recursive: true })
      const result = await codex.request<{ thread: { id: string } }>('thread/start', {
        cwd,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        serviceName: 'polotno_app',
        developerInstructions: [designInstructions(chat.docId, { images: true }), context]
          .filter(Boolean)
          .join('\n\n'),
        ...(await threadConfig(codex, { url: mcp.url, token: mcp.token }))
      })
      threadId = result.thread.id
      threadByChat.set(chat.chatId, threadId)
      chatByThread.set(threadId, chat)
    }

    emit({
      type: 'entry',
      ...chat,
      entry: { kind: 'prompt', id: crypto.randomUUID(), text: prompt }
    })
    emit({ type: 'turn', ...chat, state: 'running' })
    // The picked model (if the account still serves it), so a pick made
    // mid-conversation applies from this message on.
    const model = (await readPickedModel()) && (await threadModel(codex))
    const { turn } = await codex.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }],
      ...(model && { model })
    })
    turnByThread.set(threadId, turn.id)
    if (stopRequested.has(chat.chatId)) await stop(chat.chatId)
  } catch (error) {
    finishRun(chat)
    throw error
  }
}

// The full-size generated image behind a feed entry, for "Add to design".
async function image(id: string): Promise<LocalImage | null> {
  const path = imageFiles.get(id)
  return path ? readLocalImage(path) : null
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

async function stop(chatId: string): Promise<void> {
  const threadId = threadByChat.get(chatId)
  const turnId = threadId && turnByThread.get(threadId)
  if (server && threadId && turnId) {
    stopRequested.delete(chatId)
    await server.request('turn/interrupt', { threadId, turnId })
  } else if (busy.has(chatId)) {
    stopRequested.add(chatId)
  }
}

// Forget the chat's conversation; the next prompt starts a fresh one. A run
// in flight is interrupted first (the chat was deleted, the tab closed, or
// the token changed).
function reset(chatId: string): void {
  if (busy.has(chatId)) void stop(chatId).catch(() => undefined)
  const threadId = threadByChat.get(chatId)
  if (!threadId) return
  const chat = chatByThread.get(threadId)!
  threadByChat.delete(chatId)
  chatByThread.delete(threadId)
  turnByThread.delete(threadId)
  finishRun(chat)
}

// Chats that have a conversation with Codex.
function conversations(): ChatRef[] {
  return [...chatByThread.values()]
}

function running(): string[] {
  return [...busy.keys()]
}

function shutdown(): void {
  server?.stop()
  server = null
}

export const codexProvider: AgentProvider = {
  info: { id: 'codex', name: 'Codex' },
  getStatus: getCodexStatus,
  signIn: signInToCodex,
  getModels,
  setModel,
  run,
  stop,
  reset,
  conversations,
  running,
  image,
  shutdown
}
