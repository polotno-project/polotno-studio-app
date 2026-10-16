import { BrowserWindow } from 'electron'
import type { AgentEvent, AgentInfo, AgentModels, AgentStatus, ChatRef } from '../../shared/agent'
import type { LocalImage } from '../../mcp-server/local-image'
import { recordEntry } from './chats'

// One AI agent the panel can run: the user's own install of it, their own
// sign-in, one conversation per chat (a design's chats can run at once). Each agent edits the design only
// through our MCP server, so its changes land live and share the undo stack.
export interface AgentProvider {
  readonly info: AgentInfo
  // Starts the agent if needed (finding the binary, reading the account).
  getStatus(): Promise<AgentStatus>
  signIn(): Promise<void>
  getModels(): Promise<AgentModels>
  // Applies from the next message on; kept across launches.
  setModel(model: string | null): Promise<void>
  // Sends a message to the chat's conversation, starting one if needed.
  // While a turn runs, the message joins it (an answer, a correction).
  // `context` (the chat this conversation continues) joins the instructions
  // when a new conversation starts; ignored otherwise.
  run(chat: ChatRef, prompt: string, context?: string): Promise<void>
  stop(chatId: string): Promise<void>
  // Forgets the chat's conversation (interrupting a run in flight); the next
  // message starts a fresh one.
  reset(chatId: string): void
  // Chats that have a conversation with this agent.
  conversations(): ChatRef[]
  // Chats whose conversation is working on a turn.
  running(): string[]
  // A generated image at full size by feed entry id, or null if not this
  // agent's.
  image(id: string): Promise<LocalImage | null>
  shutdown(): void
}

export { PANEL_HIDDEN_TOOLS } from './lockdown'

// Feed entries also land in their chat (chats.ts).
export function emitAgentEvent(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('agent:event', event)
  if (event.type === 'entry') {
    void recordEntry(event).catch((error) => console.error('Recording the chat failed:', error))
  }
}
