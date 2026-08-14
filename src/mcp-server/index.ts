import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { registerTools } from './tools'
import { registerResources } from './resources'
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
polotno://skill/reference/mcp-tools.md) — it teaches the document model,
composition archetypes, and the quality rubric.

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

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'polotno', version: process.env.POLOTNO_APP_VERSION ?? '0.0.0' },
    { instructions: INSTRUCTIONS }
  )
  registerTools(server)
  registerResources(server)
  return server
}

const app = express()
app.use(express.json({ limit: '100mb' }))

// Auth + anti-rebinding: loopback host only, no cross-origin browser callers,
// per-install Bearer token compared in constant time.
app.use('/mcp', (req, res, next) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (!['127.0.0.1', 'localhost'].includes(host)) {
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
})

app.get('/', (_req, res) => {
  res.json({ name: 'polotno-app-mcp', endpoint: '/mcp' })
})

const transports = new Map<string, StreamableHTTPServerTransport>()

app.all('/mcp', (req, res) => {
  void (async () => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined
    let transport = sessionId ? transports.get(sessionId) : undefined

    if (!transport) {
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'No valid session — send initialize first' },
          id: null
        })
        return
      }
      const newTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, newTransport)
        }
      })
      newTransport.onclose = () => {
        if (newTransport.sessionId) transports.delete(newTransport.sessionId)
      }
      transport = newTransport
      await createServer().connect(transport)
    }

    await transport.handleRequest(req, res, req.body)
  })().catch((error) => {
    console.error('MCP request failed', error)
    if (!res.headersSent) res.status(500).end()
  })
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
