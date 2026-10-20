import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { registerTools, resolveTool } from './tools'
import { registerResources } from './resources'
import { registerPrompts } from './prompts'
import { announceListening } from './bridge-client'

// The MCP server for the Polotno desktop app. Runs as an Electron
// utilityProcess; serves streamable HTTP on 127.0.0.1 with a per-install
// Bearer token. Every operation routes through main into the live editor.

const TOKEN = process.env.POLOTNO_MCP_TOKEN ?? ''
const PORT = Number(process.env.POLOTNO_MCP_PORT ?? 41414)

if (!TOKEN) {
  console.error('POLOTNO_MCP_TOKEN is required')
  process.exit(1)
}

const INSTRUCTIONS = `Polotno is a local design editor the human is using right now. You edit the same
live designs they see — every edit shows up on their canvas immediately and
shares their undo stack.

Before your first design, read the resource polotno://skill/SKILL.md (and
polotno://skill/reference/runtimes/local-app.md) — it teaches the document
model, composition archetypes, and the quality rubric.

Workflow:
1. list_designs / create_design (new designs appear as background tabs).
2. Edit with the typed tools (add_element, update_element, set_page, …) for
   targeted changes; use get_design_json + patch_design_json (RFC 6902) for
   bulk or structural edits.
3. LOOK at your work: render_page after edits, and lint_design to catch text
   overflow, contrast and layout problems. Fix errors, then re-render.
4. export_design writes png/jpeg/pdf files to disk.

Coordinates: origin top-left, +y down, sizes in px. Later elements in a page
render on top. Keep designs visually clean: align to margins, limit fonts.`

// Truncated instructions silently drop rules; keep this string pointer-shaped.
// scripts/build-mcp-server.mjs enforces the same budget at build time.
if (INSTRUCTIONS.length > 4096) {
  console.error(`INSTRUCTIONS is ${INSTRUCTIONS.length} chars — budget is 4096`)
  process.exit(1)
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'polotno', version: process.env.POLOTNO_APP_VERSION ?? '0.0.0' },
    { instructions: INSTRUCTIONS }
  )
  registerTools(server)
  registerResources(server)
  registerPrompts(server)
  return server
}

const app = express()
app.use(express.json({ limit: '100mb' }))

const isLoopbackHost = (req: express.Request): boolean => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  return ['127.0.0.1', 'localhost'].includes(host)
}

// Auth + anti-rebinding: loopback host only, no cross-origin browser callers,
// per-install Bearer token compared in constant time. Shared by /mcp and the
// plain-HTTP /api/call routes.
const secure: express.RequestHandler = (req, res, next) => {
  if (!isLoopbackHost(req)) {
    res.status(403).end()
    return
  }
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.status(403).end()
    return
  }
  const auth = req.headers.authorization ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const expected = Buffer.from(TOKEN)
  const provided = Buffer.from(token)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Invalid or missing token' },
      id: null
    })
    return
  }
  next()
}

app.use('/mcp', secure)
app.use('/api/call', secure)

// Tier-detection probe for the polotno-design skill: no token needed, it
// only confirms the app is alive (loopback callers only).
app.get('/api/health', (req, res) => {
  if (!isLoopbackHost(req)) {
    res.status(403).end()
    return
  }
  res.json({ app: 'polotno', version: process.env.POLOTNO_APP_VERSION ?? '0.0.0', protocol: 1 })
})

// Plain-HTTP front door: same tools as MCP, same args, for agents that can
// curl but not speak MCP. Accepts canonical skill verbs (render, lint, …) as
// aliases for the tool names.
app.post('/api/call/:verb', (req, res) => {
  void (async () => {
    const tool = resolveTool(req.params.verb)
    if (!tool) {
      res.status(404).json({ error: `unknown_tool: ${req.params.verb}` })
      return
    }
    const parsed = z.object(tool.schema).safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_args', issues: parsed.error.issues.slice(0, 5) })
      return
    }
    const result = await tool.handler(parsed.data as Record<string, never>)
    if (result.kind === 'image') {
      const [meta, data] = result.dataUrl.split(',')
      const mimeType = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png'
      if ((req.headers.accept ?? '').includes('image/')) {
        res.type(mimeType).send(Buffer.from(data, 'base64'))
      } else {
        res.json({ dataUrl: result.dataUrl })
      }
      return
    }
    res.json(result.value)
  })().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    res
      .status(message.startsWith('rev_conflict') || message.startsWith('invalid_') ? 409 : 500)
      .json({
        error: message
      })
  })
})

app.get('/', (_req, res) => {
  res.json({ name: 'polotno-app-mcp', endpoint: '/mcp' })
})

// Stateless: a fresh server + transport per request, no sessions. The server
// never pushes to the client (no list_changed, logging, sampling), and without
// sessions a client — or the .mcpb proxy — survives an app restart untouched:
// the port and the per-install token stay the same. The .mcpb installed in
// Claude Desktop never auto-updates, so this side has to carry that.
app.post('/mcp', (req, res) => {
  void (async () => {
    const server = createServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })().catch((error) => {
    console.error('MCP request failed', error)
    if (!res.headersSent) res.status(500).end()
  })
})

// No standalone SSE stream (GET) or session to end (DELETE) without sessions.
app.all('/mcp', (_req, res) => {
  res.status(405).set('Allow', 'POST').end()
})

function listen(port: number, fallbackToEphemeral: boolean): void {
  const httpServer = app.listen(port, '127.0.0.1')
  httpServer.on('listening', () => {
    const actualPort = (httpServer.address() as AddressInfo).port
    announceListening(`http://127.0.0.1:${actualPort}/mcp`)
  })
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && fallbackToEphemeral) {
      console.error(`Port ${port} in use, falling back to an ephemeral port`)
      listen(0, false)
    } else {
      console.error('MCP server failed to listen', error)
      process.exit(1)
    }
  })
}

listen(PORT, true)
