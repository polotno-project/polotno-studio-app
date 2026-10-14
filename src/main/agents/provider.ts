import { BrowserWindow } from 'electron'
import type { AgentEvent, AgentInfo, AgentModels, AgentStatus } from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'

// One AI agent the panel can run: the user's own install of it, their own
// sign-in, one conversation per design tab. Each agent edits the design only
// through our MCP server, so its changes land live and share the undo stack.
export interface AgentProvider {
  readonly info: AgentInfo
  // Starts the agent if needed (finding the binary, reading the account).
  getStatus(): Promise<AgentStatus>
  signIn(): Promise<void>
  getModels(): Promise<AgentModels>
  // Applies from the next message on; kept across launches.
  setModel(model: string | null): Promise<void>
  // Sends a message to the design's conversation, starting one if needed.
  // While a turn runs, the message joins it (an answer, a correction).
  run(docId: DocId, prompt: string): Promise<void>
  stop(docId: DocId): Promise<void>
  // Forgets the design's conversation (interrupting a run in flight); the
  // next message starts a fresh one.
  reset(docId: DocId): void
  // The MCP token changed: every conversation holds the old one.
  resetAll(): void
  // A generated image at full size by feed entry id, or null if not this
  // agent's.
  image(id: string): Promise<LocalImage | null>
  shutdown(): void
}

export function emitAgentEvent(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('agent:event', event)
}
