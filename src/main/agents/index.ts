import type {
  AgentEntry,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentStatus,
  ChatSummary
} from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'
import {
  chatContext,
  closeChats,
  deleteChat as removeChat,
  listChats,
  moveChats,
  onChatsChanged,
  selectChat as openChat,
  startNewChat
} from './chats'
import { claudeProvider } from './claude/provider'
import { codexProvider } from './codex/provider'
import { emitAgentEvent, type AgentProvider } from './provider'
import { readSetting, writeSetting } from './settings'

// The agents the AI panel can run, and which one it runs (kept across
// launches). Each design's conversation lives in the agent that started it.

const providers: Record<AgentId, AgentProvider> = { codex: codexProvider, claude: claudeProvider }

onChatsChanged((docId) => emitAgentEvent({ type: 'chats', docId }))
const ACTIVE_SETTING = 'agent'
let active: AgentId | null = null

async function current(): Promise<AgentProvider> {
  if (!active) {
    const saved = (await readSetting<{ active: AgentId }>(ACTIVE_SETTING)).active
    active = saved && saved in providers ? saved : 'codex'
  }
  return providers[active]
}

export async function listAgents(): Promise<{ active: AgentId; agents: AgentInfo[] }> {
  const { info } = await current()
  return { active: info.id, agents: Object.values(providers).map((provider) => provider.info) }
}

// A note in each design whose agent conversation is dropped, so the history
// above it reads right. The chat itself goes on: the next message starts a new
// agent conversation that reads it first.
function endConversations(provider: AgentProvider, note: string): void {
  for (const docId of provider.conversations()) {
    provider.reset(docId)
    emitAgentEvent({
      type: 'entry',
      docId,
      entry: { kind: 'message', id: crypto.randomUUID(), text: note, done: true }
    })
  }
}

// The other agent can't see this one's conversations: they end, and the next
// message in each design starts a new one with the new agent.
export async function setActiveAgent(id: AgentId): Promise<void> {
  const previous = await current()
  if (previous.info.id === id || !(id in providers)) return
  active = id
  await writeSetting(ACTIVE_SETTING, { active: id })
  endConversations(
    previous,
    `Switched to ${providers[id].info.name}. It reads this chat before your next message.`
  )
}

export const getAgentStatus = async (): Promise<AgentStatus> => (await current()).getStatus()
export const signInToAgent = async (): Promise<void> => (await current()).signIn()
export const getAgentModels = async (): Promise<AgentModels> => (await current()).getModels()
export const setAgentModel = async (model: string | null): Promise<void> =>
  (await current()).setModel(model)
// A message to a chat with no live agent conversation (reopened, switched
// to, or after an agent switch) starts one that reads the chat first.
export async function runAgent(docId: DocId, prompt: string): Promise<void> {
  const provider = await current()
  const live = provider.conversations().includes(docId)
  await provider.run(docId, prompt, live ? undefined : await chatContext(docId))
}

export async function stopAgent(docId: DocId): Promise<void> {
  await Promise.all(Object.values(providers).map((provider) => provider.stop(docId)))
}

function endAgentConversations(docId: DocId): void {
  for (const provider of Object.values(providers)) provider.reset(docId)
}

// New chat: the open one stays in the design's list.
export async function newChat(docId: DocId): Promise<void> {
  endAgentConversations(docId)
  await startNewChat(docId)
}

export const getChats = (
  docId: DocId
): Promise<{ chats: ChatSummary[]; activeId: string | null; entries: AgentEntry[] }> =>
  listChats(docId)

export async function selectChat(docId: DocId, chatId: string): Promise<AgentEntry[]> {
  endAgentConversations(docId)
  return openChat(docId, chatId)
}

export async function deleteChat(docId: DocId, chatId: string): Promise<void> {
  const { activeId } = await listChats(docId)
  if (activeId === chatId) endAgentConversations(docId)
  await removeChat(docId, chatId)
}

// The tab closed (an agent run on it would keep spending usage on edits that
// can no longer land); its chats are kept with the design file.
export async function closeAgentConversations(docId: DocId): Promise<void> {
  endAgentConversations(docId)
  await closeChats(docId)
}

export const moveAgentChats = moveChats

// The MCP token was rotated: every conversation still holds the old one.
export function resetAllAgents(): void {
  for (const provider of Object.values(providers)) {
    endConversations(
      provider,
      'The connection token changed; the next message reconnects and reads this chat first.'
    )
  }
}

export async function agentImage(id: string): Promise<LocalImage> {
  for (const provider of Object.values(providers)) {
    const image = await provider.image(id)
    if (image) return image
  }
  throw new Error('This image is no longer available.')
}

export function shutdownAgents(): void {
  for (const provider of Object.values(providers)) provider.shutdown()
}
