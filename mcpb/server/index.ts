// Thin stdio <-> streamable-HTTP proxy for Claude Desktop (.mcpb bundle).
// The Polotno app must be running: it writes a discovery file with the local
// server url + per-install token; this proxy pipes messages both ways.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { isJSONRPCRequest, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

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

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main(): Promise<void> {
  let discovery: Discovery
  try {
    discovery = JSON.parse(fs.readFileSync(discoveryPath(), 'utf8'))
  } catch {
    fail('The Polotno app is not running (no local MCP server found). Open the Polotno app and try again.')
  }

  const stdio = new StdioServerTransport()
  const http = new StreamableHTTPClientTransport(new URL(discovery.url), {
    requestInit: { headers: { Authorization: `Bearer ${discovery.token}` } }
  })

  // Both send() calls return a promise that rejects when the hop fails, and
  // `void` does not catch a rejection — an unhandled one kills the whole proxy.
  // The app closing mid-session is enough to trigger it, so every hop reports
  // its own failure instead.
  stdio.onmessage = (message: JSONRPCMessage) => {
    http.send(message).catch((error: Error) => {
      console.error('Sending to the Polotno app failed:', error.message)
      // Answer the pending call, or the client waits for its own timeout.
      if (!isJSONRPCRequest(message)) return
      stdio
        .send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32001, message: `The Polotno app did not answer: ${error.message}` }
        })
        .catch(() => undefined)
    })
  }
  http.onmessage = (message: JSONRPCMessage) => {
    stdio.send(message).catch((error: Error) => {
      console.error('Answering the client failed:', error.message)
    })
  }
  stdio.onclose = () => process.exit(0)
  http.onclose = () => process.exit(0)
  http.onerror = (error) => {
    console.error('Connection to the Polotno app failed:', error.message)
  }

  await http.start()
  await stdio.start()
}

void main()
