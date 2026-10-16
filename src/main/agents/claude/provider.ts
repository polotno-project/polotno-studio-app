import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  query,
  type ModelInfo,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEntry, AgentModels, AgentStatus, ChatRef } from '../../../shared/agent'
import { getMcpStatus } from '../../mcp/launcher'
import { findBinary, isBatchFile, loginShellEnv, runBinary } from '../find-binary'
import { designInstructions } from '../instructions'
import { CLAUDE_RESOURCE_TOOLS } from '../lockdown'
import { emitAgentEvent, PANEL_HIDDEN_TOOLS, type AgentProvider } from '../provider'
import { readSetting, writeSetting } from '../settings'

// In-app generation through the user's own Claude Code install. The Agent SDK
// drives their installed `claude` binary, unmodified, signed in with their
// own account through Anthropic's own login (`claude auth login`); the app
// never sees or handles their credentials. One Claude session per chat,
// locked down to our MCP server: no built-in tools (no shell, files, or web),
// none of the user's own settings, MCP servers, plugins, or CLAUDE.md.

let binary: string | null = null
let version: string | null = null
// Settings exported only in the user's shell profile pick the same account
// and config the `claude` in their terminal uses.
let env: NodeJS.ProcessEnv = process.env
let status: AgentStatus = { state: 'starting' }
let checking: Promise<void> | null = null

function setStatus(next: AgentStatus): void {
  status = next
  emitAgentEvent({ type: 'status', agent: 'claude', status })
}

function entry({ docId, chatId }: ChatRef, value: AgentEntry): void {
  emitAgentEvent({ type: 'entry', docId, chatId, entry: value })
}

// --- install and sign-in ----------------------------------------------------

const SHELL_SETTINGS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL'
]

const cli = (args: string[]): Promise<string> => runBinary(binary!, args, { env })

async function check(): Promise<void> {
  env = { ...process.env, ...(await loginShellEnv(SHELL_SETTINGS)) }
  binary = await findBinary('claude', {
    envOverride: 'POLOTNO_CLAUDE_BIN',
    extra: [join(app.getPath('home'), '.claude/local/claude')]
  })
  if (!binary) return setStatus({ state: 'missing' })
  // The Agent SDK starts the binary itself, without a shell: an npm shim
  // (claude.cmd) can't be started that way on Windows.
  if (isBatchFile(binary)) {
    return setStatus({
      state: 'error',
      message:
        'Found Claude Code installed with npm (claude.cmd), which the app cannot start. Install it with the native installer (claude.exe) from docs.claude.com, then try again.'
    })
  }
  try {
    const [versionText, authText] = await Promise.all([cli(['--version']), cli(['auth', 'status'])])
    version = /\d+\.\d+\.\d+/.exec(versionText)?.[0] ?? null
    const auth = JSON.parse(authText) as {
      loggedIn: boolean
      email?: string
      subscriptionType?: string
    }
    if (!auth.loggedIn) return setStatus({ state: 'signedOut' })
    setStatus({
      state: 'ready',
      email: auth.email ?? null,
      plan: auth.subscriptionType ? `Claude ${capitalize(auth.subscriptionType)}` : null,
      version
    })
  } catch (error) {
    setStatus({ state: 'error', message: `Could not run Claude Code: ${(error as Error).message}` })
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

// The SDK speaks the protocol of the Claude Code it was released with. When a
// session fails before it starts, a much older or newer CLI is the likely
// cause: say which side to update.
const SDK_CLI_VERSION: string | undefined = __CLAUDE_CODE_VERSION__

function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

function startFailure(error: unknown): string {
  const message = `Claude Code did not start: ${(error as Error).message}`
  if (!version || !SDK_CLI_VERSION) return message
  const order = compareVersions(version, SDK_CLI_VERSION)
  if (order < 0) {
    return `${message}\n\nYour Claude Code is ${version}; this app expects ${SDK_CLI_VERSION} or newer. Run \`claude update\` in a terminal, then try again.`
  }
  if (order > 0 && version.split('.')[0] !== SDK_CLI_VERSION.split('.')[0]) {
    return `${message}\n\nYour Claude Code is ${version}, newer than this app supports (${SDK_CLI_VERSION}). Update Polotno.`
  }
  return message
}

// Re-checked on every call: the user signs in in their terminal, then
// presses Try again.
async function getStatus(): Promise<AgentStatus> {
  checking ??= check().finally(() => {
    checking = null
  })
  await checking
  return status
}

// Sign-in happens in the user's terminal through Anthropic's own flow (the
// panel shows how); here we only look again.
async function signIn(): Promise<void> {
  await getStatus()
}

// --- models -----------------------------------------------------------------

const MODEL_SETTING = 'claude-model'
let pickedModel: string | null | undefined
let modelList: Promise<ModelInfo[]> | null = null

async function readPickedModel(): Promise<string | null> {
  pickedModel ??= (await readSetting<{ model: string | null }>(MODEL_SETTING)).model ?? null
  return pickedModel
}

// The SDK lists models only from a live session; start one just for that.
function listModels(): Promise<ModelInfo[]> {
  modelList ??= (async () => {
    await fs.mkdir(workspace(), { recursive: true })
    const idle = new MessageQueue()
    const probe = query({ prompt: idle, options: baseOptions() })
    try {
      return await probe.supportedModels()
    } finally {
      idle.end()
      probe.close()
    }
  })().catch((error) => {
    modelList = null
    throw new Error(startFailure(error))
  })
  return modelList
}

async function getModels(): Promise<AgentModels> {
  if (status.state !== 'ready') return { models: [], selected: null }
  const [data, picked] = await Promise.all([listModels(), readPickedModel()])
  // The aliases (default, opus, sonnet, …) follow the latest versions; the
  // pinned older versions stay out of the menu unless one is the pick.
  return {
    models: data
      .filter((model) => !model.value.startsWith('claude-') || model.value === picked)
      .map((model) => ({
        id: model.value,
        name: model.displayName,
        description: model.description,
        isDefault: model.value === 'default'
      })),
    selected: data.some((model) => model.value === picked) ? picked : null
  }
}

// Applies from the next message on, in every open conversation.
async function setModel(model: string | null): Promise<void> {
  pickedModel = model
  await writeSetting(MODEL_SETTING, { model })
  for (const session of sessions.values()) {
    await session.query.setModel(model ?? undefined).catch(() => undefined)
  }
}

// --- sessions ---------------------------------------------------------------

// The prompt stream of a session: messages wait here until Claude takes them.
class MessageQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = []
  private wake: (() => void) | null = null
  private ended = false

  push(message: SDKUserMessage): void {
    this.items.push(message)
    this.wake?.()
  }

  end(): void {
    this.ended = true
    this.wake?.()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (!this.ended) {
      const next = this.items.shift()
      if (next) yield next
      else await new Promise<void>((resolve) => (this.wake = resolve))
    }
  }
}

type Session = {
  chat: ChatRef
  query: Query
  input: MessageQueue
  // Messages sent that Claude has not taken yet. A message sent while Claude
  // works is usually folded into the running turn, else it starts the next
  // one; the turn is over when a result arrives with nothing left.
  pending: Set<string>
  running: boolean
  stopping: boolean
  // Claude Code reported in (its init message): later failures are not about
  // starting it.
  started: boolean
  // The streamed text blocks of the current assistant message, by index.
  messageId: string
  text: Map<number, { id: string; text: string }>
  tools: Map<string, string>
}

// By chat id.
const sessions = new Map<string, Session>()

function workspace(): string {
  return join(app.getPath('userData'), 'claude-workspace')
}

function baseOptions(): Parameters<typeof query>[0]['options'] {
  return {
    pathToClaudeCodeExecutable: binary!,
    cwd: workspace(),
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `polotno-app/${app.getVersion()}` },
    // None of the user's own settings, hooks, CLAUDE.md, MCP servers or
    // plugins, and no built-in tools: nothing that could read their files on
    // behalf of a prompt that arrived inside a design.
    settingSources: [],
    strictMcpConfig: true,
    tools: [],
    skills: [],
    permissionMode: 'dontAsk',
    persistSession: false
  }
}

async function startSession(
  chat: ChatRef,
  mcp: { url: string; token: string },
  context?: string
): Promise<Session> {
  await fs.mkdir(workspace(), { recursive: true })
  const input = new MessageQueue()
  const model = await readPickedModel()
  const session: Session = {
    chat,
    query: query({
      prompt: input,
      options: {
        ...baseOptions(),
        mcpServers: {
          polotno: {
            type: 'http',
            url: mcp.url,
            // The chat, so the canvas shows this conversation's own cursor.
            headers: { Authorization: `Bearer ${mcp.token}`, 'X-Polotno-Chat': chat.chatId }
          }
        },
        // Only the tools that read our MCP server's resources (the design
        // guide), next to its own tools.
        tools: CLAUDE_RESOURCE_TOOLS,
        allowedTools: ['mcp__polotno__*', ...CLAUDE_RESOURCE_TOOLS],
        disallowedTools: PANEL_HIDDEN_TOOLS.map((tool) => `mcp__polotno__${tool}`),
        includePartialMessages: true,
        systemPrompt: [designInstructions(chat.docId, { images: false }), context]
          .filter(Boolean)
          .join('\n\n'),
        ...(model && { model })
      }
    }),
    input,
    pending: new Set(),
    running: false,
    stopping: false,
    started: false,
    messageId: '',
    text: new Map(),
    tools: new Map()
  }
  sessions.set(chat.chatId, session)
  void consume(session)
  return session
}

async function consume(session: Session): Promise<void> {
  const { chat } = session
  try {
    for await (const message of session.query) onMessage(session, message)
  } catch (error) {
    if (sessions.get(chat.chatId) === session) {
      entry(chat, {
        kind: 'error',
        id: crypto.randomUUID(),
        text: session.started ? `Claude stopped: ${(error as Error).message}` : startFailure(error)
      })
    }
  } finally {
    // The session ended (closed, or the process died): the next message
    // starts a new one.
    if (sessions.get(chat.chatId) === session) sessions.delete(chat.chatId)
    if (session.running) finishRun(session)
  }
}

function finishRun(session: Session): void {
  session.running = false
  session.stopping = false
  session.pending.clear()
  emitAgentEvent({ type: 'turn', ...session.chat, state: 'idle' })
}

// polotno tools arrive as mcp__polotno__add_element.
const toolName = (name: string): string => name.replace(/^mcp__polotno__/, '')

function onMessage(session: Session, message: SDKMessage): void {
  const { chat } = session
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init') session.started = true
      return
    case 'stream_event': {
      const event = message.event
      if (event.type === 'message_start') {
        session.messageId = event.message.id
        session.text.clear()
      } else if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'text') {
          session.text.set(event.index, { id: `${session.messageId}:${event.index}`, text: '' })
        } else if (block.type === 'tool_use') {
          session.tools.set(block.id, toolName(block.name))
          entry(chat, {
            kind: 'tool',
            id: block.id,
            tool: toolName(block.name),
            status: 'running'
          })
        }
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const block = session.text.get(event.index)
        if (!block) return
        block.text += event.delta.text
        entry(chat, { kind: 'message', id: block.id, text: block.text, done: false })
      } else if (event.type === 'content_block_stop') {
        const block = session.text.get(event.index)
        if (block) entry(chat, { kind: 'message', id: block.id, text: block.text, done: true })
      }
      return
    }
    case 'assistant':
      for (const id of message.user_message_uuids ?? []) session.pending.delete(id)
      // API failures (rate limit, expired sign-in) come as a synthetic
      // message that was never streamed.
      if (message.error) {
        const text = message.message.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('')
        entry(chat, { kind: 'error', id: message.uuid, text: text || message.error })
      }
      return
    case 'user': {
      const content = message.message.content
      if (typeof content === 'string') return
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        const tool = session.tools.get(block.tool_use_id)
        if (!tool) continue
        entry(chat, {
          kind: 'tool',
          id: block.tool_use_id,
          tool,
          status: block.is_error ? 'failed' : 'done',
          error: block.is_error ? resultText(block.content) : undefined
        })
      }
      return
    }
    case 'result': {
      const consumed =
        message.user_message_uuids ??
        (message.user_message_uuid ? [message.user_message_uuid] : [...session.pending])
      for (const id of consumed) session.pending.delete(id)
      if (session.stopping) {
        entry(chat, { kind: 'message', id: message.uuid, text: 'Stopped.', done: true })
      } else if (message.subtype !== 'success') {
        entry(chat, {
          kind: 'error',
          id: message.uuid,
          text: message.errors.join('\n') || 'Claude could not finish.'
        })
      }
      if (session.pending.size === 0) finishRun(session)
      return
    }
  }
}

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content.map((part) => (part?.type === 'text' ? part.text : '')).join('') || undefined
}

async function run(chat: ChatRef, prompt: string, context?: string): Promise<void> {
  if (status.state !== 'ready') await getStatus()
  if (status.state !== 'ready') throw new Error('Claude is not ready.')
  const mcp = getMcpStatus()
  if (!mcp.url) throw new Error('The Polotno MCP server is not running.')
  const session =
    sessions.get(chat.chatId) ??
    (await startSession(chat, { url: mcp.url, token: mcp.token }, context))
  const uuid = crypto.randomUUID()
  session.pending.add(uuid)
  entry(chat, { kind: 'prompt', id: uuid, text: prompt })
  if (!session.running) {
    session.running = true
    emitAgentEvent({ type: 'turn', ...chat, state: 'running' })
  }
  session.input.push({
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
    uuid
  })
}

async function stop(chatId: string): Promise<void> {
  const session = sessions.get(chatId)
  if (!session?.running) return
  session.stopping = true
  await session.query.interrupt()
}

function reset(chatId: string): void {
  const session = sessions.get(chatId)
  if (!session) return
  sessions.delete(chatId)
  session.input.end()
  session.query.close()
  if (session.running) finishRun(session)
}

function conversations(): ChatRef[] {
  return [...sessions.values()].map((session) => session.chat)
}

function running(): string[] {
  return [...sessions.values()].filter((session) => session.running).map((s) => s.chat.chatId)
}

function shutdown(): void {
  for (const chatId of [...sessions.keys()]) reset(chatId)
}

export const claudeProvider: AgentProvider = {
  info: { id: 'claude', name: 'Claude' },
  getStatus,
  signIn,
  getModels,
  setModel,
  run,
  stop,
  reset,
  conversations,
  running,
  // Claude has no image generation.
  image: async () => null,
  shutdown
}
