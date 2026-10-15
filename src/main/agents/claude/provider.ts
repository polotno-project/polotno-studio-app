import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  query,
  type ModelInfo,
  type Query,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentEntry, AgentModels, AgentStatus } from '../../../shared/agent'
import type { DocId } from '../../../shared/types'
import { getMcpStatus } from '../../mcp/launcher'
import { findBinary } from '../find-binary'
import { designInstructions } from '../instructions'
import { emitAgentEvent, type AgentProvider } from '../provider'
import { readSetting, writeSetting } from '../settings'

// In-app generation through the user's own Claude Code install. The Agent SDK
// drives their installed `claude` binary, unmodified, signed in with their
// own account through Anthropic's own login (`claude auth login`); the app
// never sees or handles their credentials. One Claude session per design tab,
// locked down to our MCP server: no built-in tools (no shell, files, or web),
// none of the user's own settings, MCP servers, plugins, or CLAUDE.md.

let binary: string | null = null
let status: AgentStatus = { state: 'starting' }
let checking: Promise<void> | null = null

function setStatus(next: AgentStatus): void {
  status = next
  emitAgentEvent({ type: 'status', agent: 'claude', status })
}

function entry(docId: DocId, value: AgentEntry): void {
  emitAgentEvent({ type: 'entry', docId, entry: value })
}

// --- install and sign-in ----------------------------------------------------

// Runs the CLI and returns its stdout even when it exits non-zero
// (`claude auth status` exits 1 when signed out).
function cli(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary!, args, { timeout: 15000 }, (error, stdout) => {
      if (stdout) resolve(stdout)
      else reject(error ?? new Error(`claude ${args.join(' ')} printed nothing`))
    })
  })
}

async function check(): Promise<void> {
  binary = await findBinary('claude', {
    envOverride: 'POLOTNO_CLAUDE_BIN',
    extra: [join(app.getPath('home'), '.claude/local/claude')]
  })
  if (!binary) return setStatus({ state: 'missing' })
  try {
    const [versionText, authText] = await Promise.all([cli(['--version']), cli(['auth', 'status'])])
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
      version: /\d+\.\d+\.\d+/.exec(versionText)?.[0] ?? null
    })
  } catch (error) {
    setStatus({ state: 'error', message: `Could not run Claude Code: ${(error as Error).message}` })
  }
}

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

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
    throw error
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
  query: Query
  input: MessageQueue
  // Messages sent that Claude has not taken yet. A message sent while Claude
  // works is usually folded into the running turn, else it starts the next
  // one; the turn is over when a result arrives with nothing left.
  pending: Set<string>
  running: boolean
  stopping: boolean
  // The streamed text blocks of the current assistant message, by index.
  messageId: string
  text: Map<number, { id: string; text: string }>
  tools: Map<string, string>
}

const sessions = new Map<DocId, Session>()

const RESOURCE_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool']

function workspace(): string {
  return join(app.getPath('userData'), 'claude-workspace')
}

function baseOptions(): Parameters<typeof query>[0]['options'] {
  return {
    pathToClaudeCodeExecutable: binary!,
    cwd: workspace(),
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: `polotno-app/${app.getVersion()}` },
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

async function startSession(docId: DocId, mcp: { url: string; token: string }): Promise<Session> {
  await fs.mkdir(workspace(), { recursive: true })
  const input = new MessageQueue()
  const model = await readPickedModel()
  const session: Session = {
    query: query({
      prompt: input,
      options: {
        ...baseOptions(),
        mcpServers: {
          polotno: {
            type: 'http',
            url: mcp.url,
            headers: { Authorization: `Bearer ${mcp.token}` }
          }
        },
        // Only the tools that read our MCP server's resources (the design
        // guide), next to its own tools.
        tools: RESOURCE_TOOLS,
        allowedTools: ['mcp__polotno__*', ...RESOURCE_TOOLS],
        includePartialMessages: true,
        systemPrompt: designInstructions(docId, { images: false }),
        ...(model && { model })
      }
    }),
    input,
    pending: new Set(),
    running: false,
    stopping: false,
    messageId: '',
    text: new Map(),
    tools: new Map()
  }
  sessions.set(docId, session)
  void consume(docId, session)
  return session
}

async function consume(docId: DocId, session: Session): Promise<void> {
  try {
    for await (const message of session.query) onMessage(docId, session, message)
  } catch (error) {
    if (sessions.get(docId) === session) {
      entry(docId, {
        kind: 'error',
        id: crypto.randomUUID(),
        text: `Claude stopped: ${(error as Error).message}`
      })
    }
  } finally {
    // The session ended (closed, or the process died): the next message
    // starts a new one.
    if (sessions.get(docId) === session) sessions.delete(docId)
    if (session.running) finishRun(docId, session)
  }
}

function finishRun(docId: DocId, session: Session): void {
  session.running = false
  session.stopping = false
  session.pending.clear()
  emitAgentEvent({ type: 'turn', docId, state: 'idle' })
}

// polotno tools arrive as mcp__polotno__add_element.
const toolName = (name: string): string => name.replace(/^mcp__polotno__/, '')

function onMessage(docId: DocId, session: Session, message: SDKMessage): void {
  switch (message.type) {
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
          entry(docId, {
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
        entry(docId, { kind: 'message', id: block.id, text: block.text, done: false })
      } else if (event.type === 'content_block_stop') {
        const block = session.text.get(event.index)
        if (block) entry(docId, { kind: 'message', id: block.id, text: block.text, done: true })
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
        entry(docId, { kind: 'error', id: message.uuid, text: text || message.error })
      }
      return
    case 'user': {
      const content = message.message.content
      if (typeof content === 'string') return
      for (const block of content) {
        if (block.type !== 'tool_result') continue
        const tool = session.tools.get(block.tool_use_id)
        if (!tool) continue
        entry(docId, {
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
        entry(docId, { kind: 'message', id: message.uuid, text: 'Stopped.', done: true })
      } else if (message.subtype !== 'success') {
        entry(docId, {
          kind: 'error',
          id: message.uuid,
          text: message.errors.join('\n') || 'Claude could not finish.'
        })
      }
      if (session.pending.size === 0) finishRun(docId, session)
      return
    }
  }
}

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content.map((part) => (part?.type === 'text' ? part.text : '')).join('') || undefined
}

async function run(docId: DocId, prompt: string): Promise<void> {
  if (status.state !== 'ready') await getStatus()
  if (status.state !== 'ready') throw new Error('Claude is not ready.')
  const mcp = getMcpStatus()
  if (!mcp.url) throw new Error('The Polotno MCP server is not running.')
  const session =
    sessions.get(docId) ?? (await startSession(docId, { url: mcp.url, token: mcp.token }))
  const uuid = crypto.randomUUID()
  session.pending.add(uuid)
  entry(docId, { kind: 'prompt', id: uuid, text: prompt })
  if (!session.running) {
    session.running = true
    emitAgentEvent({ type: 'turn', docId, state: 'running' })
  }
  session.input.push({
    type: 'user',
    message: { role: 'user', content: prompt },
    parent_tool_use_id: null,
    uuid
  })
}

async function stop(docId: DocId): Promise<void> {
  const session = sessions.get(docId)
  if (!session?.running) return
  session.stopping = true
  await session.query.interrupt()
}

function reset(docId: DocId): void {
  const session = sessions.get(docId)
  if (!session) return
  sessions.delete(docId)
  session.input.end()
  session.query.close()
  if (session.running) finishRun(docId, session)
}

function conversations(): DocId[] {
  return [...sessions.keys()]
}

function shutdown(): void {
  for (const docId of [...sessions.keys()]) reset(docId)
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
  // Claude has no image generation.
  image: async () => null,
  shutdown
}
