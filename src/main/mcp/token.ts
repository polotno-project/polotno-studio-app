import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { promises as fs, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Per-install auth token for the local MCP server, plus the discovery file
// clients (the .mcpb stdio proxy, the Connect panel) read to find url + token.

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function discoveryPath(): string {
  return join(app.getPath('userData'), 'mcp.json')
}

interface Settings {
  mcpToken?: string
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function getMcpToken(): string {
  const settings = readSettings()
  if (settings.mcpToken) return settings.mcpToken
  return regenerateMcpToken()
}

export function regenerateMcpToken(): string {
  const token = randomBytes(32).toString('hex')
  const settings = readSettings()
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify({ ...settings, mcpToken: token }, null, 2))
  return token
}

export interface McpDiscovery {
  url: string
  token: string
  pid: number
  appVersion: string
  startedAt: string
}

export async function writeDiscoveryFile(url: string, token: string): Promise<void> {
  const discovery: McpDiscovery = {
    url,
    token,
    pid: process.pid,
    appVersion: app.getVersion(),
    startedAt: new Date().toISOString()
  }
  await fs.writeFile(discoveryPath(), JSON.stringify(discovery, null, 2))
}

export function removeDiscoveryFile(): void {
  // Sync: called from will-quit.
  try {
    rmSync(discoveryPath(), { force: true })
  } catch {
    // best-effort
  }
}

// A discovery file left by a crashed instance would point clients at a dead
// server; clear it if its pid is gone.
export function cleanStaleDiscovery(): void {
  try {
    const discovery: McpDiscovery = JSON.parse(readFileSync(discoveryPath(), 'utf8'))
    try {
      process.kill(discovery.pid, 0)
    } catch {
      rmSync(discoveryPath(), { force: true })
    }
  } catch {
    // no file or unreadable — nothing to do
  }
}
