import { BrowserWindow } from 'electron'
import type { AgentEvent, AgentInfo, AgentModels, AgentStatus } from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'
import { recordEntry } from './chats'

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
  // `context` (the chat this conversation continues) joins the instructions
  // when a new conversation starts; ignored otherwise.
  run(docId: DocId, prompt: string, context?: string): Promise<void>
  stop(docId: DocId): Promise<void>
  // Forgets the design's conversation (interrupting a run in flight); the
  // next message starts a fresh one.
  reset(docId: DocId): void
  // Designs that have a conversation with this agent.
  conversations(): DocId[]
  // A generated image at full size by feed entry id, or null if not this
  // agent's.
  image(id: string): Promise<LocalImage | null>
  shutdown(): void
}

// The panel's agent works on the design the user has open: the tools that
// list, open, create or save designs only cost tokens on every call.
export const PANEL_HIDDEN_TOOLS = ['list_designs', 'create_design', 'open_design', 'save_design']

// Feed entries also land in the design's open chat (chats.ts).
export function emitAgentEvent(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('agent:event', event)
  if (event.type === 'entry') {
    void recordEntry(event).catch((error) => console.error('Recording the chat failed:', error))
  }
}
