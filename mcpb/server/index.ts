// Thin stdio <-> streamable-HTTP proxy for Claude Desktop (.mcpb bundle).
// The Polotno app must be running: it writes a discovery file with the local
// server url + per-install token; this proxy pipes messages both ways.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

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

  stdio.onmessage = (message) => void http.send(message)
  http.onmessage = (message) => void stdio.send(message)
  stdio.onclose = () => process.exit(0)
  http.onclose = () => process.exit(0)
  http.onerror = (error) => {
    console.error('Connection to the Polotno app failed:', error.message)
  }

  await http.start()
  await stdio.start()
}

void main()
