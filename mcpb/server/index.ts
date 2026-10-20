// Thin stdio <-> streamable-HTTP proxy for Claude Desktop (.mcpb bundle).
// The Polotno app writes a discovery file with the local server url +
// per-install token; this proxy finds the app through it and pipes messages
// both ways.
//
// The proxy never exits on its own and always answers a request. Clients
// probe `server/discover` before `initialize`, and a stdio server that closes
// during the probe is a hard connect failure ("Version negotiation failed: the
// connection closed during the server/discover probe"), while any JSON-RPC
// error falls back to `initialize`. The app's server is stateless, so after an
// app restart the proxy only has to re-read the discovery file and resend.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  ErrorCode,
  isInitializeRequest,
  isJSONRPCRequest,
  type JSONRPCMessage
} from '@modelcontextprotocol/sdk/types.js'

// How long `initialize` waits for the app to come up — covers "I just opened
// it". Every other message gets one resend on a fresh connection.
const APP_WAIT_MS = 20_000
const APP_POLL_MS = 500

const NOT_RUNNING = 'The Polotno app is not running. Open the Polotno app and try again.'

function discoveryPath(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library/Application Support/polotno-app/mcp.json')
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? '', 'polotno-app/mcp.json')
  }
  return path.join(os.homedir(), '.config/polotno-app/mcp.json')
}

interface Discovery {
  url: string
  token: string
}

// Read fresh on every connect: the app rewrites it on each start.
function readDiscovery(): Discovery | null {
  try {
    const discovery = JSON.parse(fs.readFileSync(discoveryPath(), 'utf8')) as Discovery
    return discovery.url && discovery.token ? discovery : null
  } catch {
    return null
  }
}

const stdio = new StdioServerTransport()

function toClient(message: JSONRPCMessage): void {
  stdio.send(message).catch((error: Error) => {
    console.error('Answering the client failed:', error.message)
  })
}

let upstream: StreamableHTTPClientTransport | null = null

async function connect(): Promise<StreamableHTTPClientTransport | null> {
  const discovery = readDiscovery()
  if (!discovery) return null
  const transport = new StreamableHTTPClientTransport(new URL(discovery.url), {
    requestInit: { headers: { Authorization: `Bearer ${discovery.token}` } }
  })
  transport.onmessage = toClient
  transport.onerror = (error) => {
    console.error('Connection to the Polotno app failed:', error.message)
  }
  transport.onclose = () => {
    if (upstream === transport) upstream = null
  }
  await transport.start()
  upstream = transport
  return transport
}

// Send on the live connection; on failure, reconnect from a fresh discovery
// file (the app may have restarted) and resend — once, or until `waitMs` runs
// out. A request that still fails is answered, never left hanging.
async function deliver(message: JSONRPCMessage, waitMs: number): Promise<void> {
  const deadline = Date.now() + waitMs
  let lastError: unknown
  for (let attempt = 0; ; attempt++) {
    const transport = upstream ?? (await connect())
    if (transport) {
      try {
        await transport.send(message)
        return
      } catch (error) {
        lastError = error
        void transport.close()
      }
    }
    if (attempt > 0 && Date.now() >= deadline) break
    if (attempt > 0) await sleep(APP_POLL_MS)
  }
  if (!isJSONRPCRequest(message)) return
  // The app answered with an HTTP error: pass that on. Anything else (no
  // discovery file, refused connection) means the app is not there.
  const text =
    lastError instanceof StreamableHTTPError
      ? `The Polotno app did not answer: ${lastError.message}`
      : NOT_RUNNING
  toClient({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: ErrorCode.ConnectionClosed, message: text }
  })
}

stdio.onmessage = (message: JSONRPCMessage) => {
  const waitMs = isJSONRPCRequest(message) && isInitializeRequest(message) ? APP_WAIT_MS : 0
  deliver(message, waitMs).catch((error: Error) => {
    console.error('Proxying failed:', error.message)
  })
}
stdio.onerror = (error) => {
  console.error('stdio error:', error.message)
}
stdio.onclose = () => process.exit(0)

void stdio.start()
