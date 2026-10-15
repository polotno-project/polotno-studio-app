// Token benchmark for the AI panel: runs one prompt against a fixture design
// with Claude or Codex, set up the way the panel sets them up (same
// instructions, tools, and lockdown), and prints one JSON line per run with
// tokens, cost (Claude), turns, time, and the tool calls with their result
// sizes. Use it to measure prompt and tool changes before and after.
//
// Needs the app running (dev or packaged; its MCP server is what the agents
// talk to) and the user's own `claude` / `codex` signed in. Each run creates
// a design named "bench …" in the library: delete them afterwards.
//
//   node scripts/agent-bench.mts --agent claude --fixture src/renderer/src/templates/welcome.json \
//     --runs 3 [--model haiku] [--user-data <dir>] [--out results.jsonl] "Make the title red"
//
// --user-data: the app's userData folder (where mcp.json is), when it was
// started with --user-data-dir. Node >= 22.18 (type stripping).
import { spawn, execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { designInstructions } from '../src/main/agents/instructions.ts'
import {
  CLAUDE_RESOURCE_TOOLS,
  CODEX_DISABLED_FEATURES,
  PANEL_HIDDEN_TOOLS
} from '../src/main/agents/lockdown.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: 'string', default: 'claude' },
    fixture: { type: 'string' },
    model: { type: 'string' },
    runs: { type: 'string', default: '1' },
    'user-data': { type: 'string' },
    out: { type: 'string' }
  }
})
const prompt = positionals.join(' ')
if (!values.fixture || !prompt || !['claude', 'codex'].includes(values.agent!)) {
  console.error('usage: agent-bench.mts --agent claude|codex --fixture <design.json> "<prompt>"')
  process.exit(1)
}

function defaultUserData(): string {
  if (process.platform === 'darwin')
    return join(homedir(), 'Library/Application Support/polotno-app')
  if (process.platform === 'win32') return join(process.env.APPDATA ?? '', 'polotno-app')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'polotno-app')
}

const mcp = JSON.parse(
  readFileSync(join(values['user-data'] ?? defaultUserData(), 'mcp.json'), 'utf8')
) as { url: string; token: string }
const auth = { Authorization: `Bearer ${mcp.token}` }
const client = new Client({ name: 'agent-bench', version: '1' })
await client.connect(
  new StreamableHTTPClientTransport(new URL(mcp.url), { requestInit: { headers: auth } })
)
const fixture = JSON.parse(readFileSync(values.fixture, 'utf8'))
const workspace = mkdtempSync(join(tmpdir(), 'polotno-bench-'))
const which = (command: string): string => execFileSync('which', [command]).toString().trim()

type Usage = { input: number; cacheRead: number; cacheWrite: number; output: number }
type Run = {
  ok: boolean
  turns?: number
  cost?: number
  usage: Usage
  tools: string[]
  reply: string
}

// --- Claude: the Agent SDK with the panel's options --------------------------

async function runClaude(designId: string): Promise<Run> {
  const tools: string[] = []
  const names = new Map<string, string>()
  let result:
    | Extract<Awaited<ReturnType<ReturnType<typeof query>['next']>>['value'], { type: 'result' }>
    | undefined
  for await (const message of query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: which('claude'),
      cwd: workspace,
      settingSources: [],
      strictMcpConfig: true,
      skills: [],
      permissionMode: 'dontAsk',
      persistSession: false,
      mcpServers: { polotno: { type: 'http', url: mcp.url, headers: auth } },
      tools: CLAUDE_RESOURCE_TOOLS,
      allowedTools: ['mcp__polotno__*', ...CLAUDE_RESOURCE_TOOLS],
      disallowedTools: PANEL_HIDDEN_TOOLS.map((tool) => `mcp__polotno__${tool}`),
      systemPrompt: designInstructions(designId, { images: false }),
      ...(values.model && { model: values.model })
    }
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') names.set(block.id, block.name.replace('mcp__polotno__', ''))
      }
    } else if (message.type === 'user' && Array.isArray(message.message.content)) {
      for (const block of message.message.content) {
        if (block.type !== 'tool_result') continue
        const content = Array.isArray(block.content)
          ? block.content
          : [{ type: 'text', text: String(block.content ?? '') }]
        const size = content.some((part) => part.type === 'image')
          ? 'img'
          : content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 0), 0)
        tools.push(`${names.get(block.tool_use_id) ?? '?'}:${size}`)
      }
    } else if (message.type === 'result') result = message
  }
  if (!result) throw new Error('Claude ended without a result.')
  const u = result.usage
  return {
    ok: result.subtype === 'success',
    turns: result.num_turns,
    cost: result.total_cost_usd,
    usage: {
      input: u.input_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      output: u.output_tokens
    },
    tools,
    reply: result.subtype === 'success' ? result.result : result.errors.join('\n')
  }
}

// --- Codex: app-server with the panel's thread config ------------------------

type Rpc = {
  request: <T>(method: string, params: unknown) => Promise<T>
  notify: (method: string, params: unknown) => void
  on: (handler: (method: string, params: Record<string, unknown>) => void) => void
  stop: () => void
}

function appServer(): Rpc {
  const proc = spawn(which('codex'), ['app-server'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  const handlers: ((method: string, params: Record<string, unknown>) => void)[] = []
  let next = 1
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const message = JSON.parse(line)
    if (message.id !== undefined && message.method) {
      // Server requests (approvals): the panel declines them all.
      proc.stdin.write(JSON.stringify({ id: message.id, result: { decision: 'decline' } }) + '\n')
    } else if (message.id !== undefined) {
      const waiter = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) waiter?.reject(new Error(message.error.message))
      else waiter?.resolve(message.result)
    } else if (message.method)
      for (const handler of handlers) handler(message.method, message.params ?? {})
  })
  return {
    request: <T,>(method: string, params: unknown) =>
      new Promise<T>((resolve, reject) => {
        const id = next++
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
        proc.stdin.write(JSON.stringify({ id, method, params }) + '\n')
      }),
    notify: (method, params) => proc.stdin.write(JSON.stringify({ method, params }) + '\n'),
    on: (handler) => handlers.push(handler),
    stop: () => proc.kill()
  }
}

let codex: Rpc | null = null

async function runCodex(designId: string): Promise<Run> {
  if (!codex) {
    codex = appServer()
    await codex.request('initialize', {
      clientInfo: { name: 'polotno_bench', title: 'Polotno bench', version: '1' }
    })
    codex.notify('initialized', {})
  }
  const rpc = codex
  const { config } = await rpc.request<{ config: { mcp_servers?: Record<string, unknown> } }>(
    'config/read',
    {}
  )
  const own = Object.keys(config.mcp_servers ?? {}).filter((name) => name !== 'polotno')
  const { thread } = await rpc.request<{ thread: { id: string } }>('thread/start', {
    cwd: workspace,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    ephemeral: true,
    serviceName: 'polotno_bench',
    developerInstructions: designInstructions(designId, { images: true }),
    ...(values.model && { model: values.model }),
    config: {
      mcp_servers: {
        ...Object.fromEntries(own.map((name) => [name, { enabled: false }])),
        polotno: {
          url: mcp.url,
          http_headers: auth,
          default_tools_approval_mode: 'approve',
          disabled_tools: PANEL_HIDDEN_TOOLS,
          tool_timeout_sec: 180
        }
      },
      'features.image_generation': true,
      web_search: 'disabled',
      ...Object.fromEntries(
        CODEX_DISABLED_FEATURES.map((feature) => [`features.${feature}`, false])
      )
    }
  })
  const tools: string[] = []
  let usage: Usage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let reply = ''
  const done = new Promise<boolean>((resolve) =>
    rpc.on((method, params) => {
      if (params.threadId !== thread.id) return
      const item = params.item as
        | {
            type: string
            tool?: string
            server?: string
            text?: string
            result?: unknown
            status?: string
          }
        | undefined
      if (method === 'item/completed' && item?.type === 'mcpToolCall') {
        // Same measure as for Claude: text length, or "img" with a render.
        const content =
          (item.result as { content?: { type: string; text?: string }[] } | null)?.content ?? []
        const size = content.some((part) => part.type === 'image')
          ? 'img'
          : content.reduce((n, part) => n + (part.text?.length ?? 0), 0)
        tools.push(`${item.tool}:${size}`)
      } else if (method === 'item/completed' && item?.type === 'imageGeneration') {
        tools.push('image_generation')
      } else if (method === 'item/completed' && item?.type === 'agentMessage') {
        reply = item.text ?? ''
      } else if (method === 'thread/tokenUsage/updated') {
        const total = (params.tokenUsage as { total: Record<string, number> }).total
        // inputTokens includes the cached part.
        usage = {
          input: total.inputTokens - total.cachedInputTokens,
          cacheRead: total.cachedInputTokens,
          cacheWrite: total.cacheWriteInputTokens ?? 0,
          output: total.outputTokens
        }
      } else if (method === 'turn/completed') {
        resolve((params.turn as { status?: string }).status === 'completed')
      }
    })
  )
  await rpc.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: prompt }] })
  return { ok: await done, usage, tools, reply }
}

// --- runs ----------------------------------------------------------------------

for (let i = 0; i < Number(values.runs); i++) {
  const created = (await client.callTool({
    name: 'create_design',
    arguments: {
      name: `bench ${values.agent} ${new Date().toISOString().slice(11, 19)} ${i}`,
      json: fixture
    }
  })) as { content: { text: string }[] }
  const { designId } = JSON.parse(created.content[0].text)
  const started = Date.now()
  const run = values.agent === 'claude' ? await runClaude(designId) : await runCodex(designId)
  const row = {
    agent: values.agent,
    model: values.model ?? 'default',
    fixture: values.fixture.split('/').pop(),
    prompt,
    at: new Date().toISOString(),
    ms: Date.now() - started,
    ...run,
    totalIn: run.usage.input + run.usage.cacheRead + run.usage.cacheWrite,
    tools: run.tools.join(' '),
    reply: run.reply.slice(0, 160)
  }
  console.log(JSON.stringify(row))
  if (values.out) {
    mkdirSync(join(values.out, '..'), { recursive: true })
    appendFileSync(values.out, JSON.stringify(row) + '\n')
  }
}
codex?.stop()
await client.close()
