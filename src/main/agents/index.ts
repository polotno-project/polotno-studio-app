import type {
  AgentEntry,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentStatus,
  ChatRef,
  ChatSummary
} from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'
import {
  chatContext,
  chatImage,
  closeChats,
  deleteChat as removeChat,
  listChats,
  moveChats,
  onChatsChanged,
  openChatFor,
  selectChat as openChat,
  startNewChat
} from './chats'
import { claudeProvider } from './claude/provider'
import { codexProvider } from './codex/provider'
import { emitAgentEvent, type AgentProvider } from './provider'
import { readSetting, writeSetting } from './settings'

// The agents the AI panel can run, and which one it runs (kept across
// launches). Each chat's conversation lives in the agent that started it; a
// design's chats run side by side.

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

// A note in each chat whose agent conversation is dropped, so the history
// above it reads right. The chat itself goes on: the next message starts a new
// agent conversation that reads it first.
function endConversations(provider: AgentProvider, note: string): void {
  for (const chat of provider.conversations()) {
    provider.reset(chat.chatId)
    emitAgentEvent({
      type: 'entry',
      ...chat,
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
// A message goes to the design's open chat (a new one if none is open). A
// chat with no live agent conversation (reopened, or after an agent switch)
// starts one that reads the chat first. Returns the chat's id.
export async function runAgent(docId: DocId, prompt: string): Promise<string> {
  const provider = await current()
  const chat: ChatRef = { docId, chatId: await openChatFor(docId, prompt) }
  const live = provider.conversations().some((item) => item.chatId === chat.chatId)
  await provider.run(chat, prompt, live ? undefined : await chatContext(chat))
  return chat.chatId
}

export async function stopAgent(chatId: string): Promise<void> {
  await Promise.all(Object.values(providers).map((provider) => provider.stop(chatId)))
}

function endChatConversation(chatId: string): void {
  for (const provider of Object.values(providers)) provider.reset(chatId)
}

// New chat: the open one stays in the design's list, and keeps running if it
// is.
export async function newChat(docId: DocId): Promise<void> {
  await startNewChat(docId)
}

// Which of them are working: the panel reloads (or opens on another design)
// while chats run.
export async function getChats(docId: DocId): Promise<{
  chats: ChatSummary[]
  activeId: string | null
  entries: AgentEntry[]
  running: string[]
}> {
  const running = Object.values(providers).flatMap((provider) => provider.running())
  const list = await listChats(docId)
  return {
    ...list,
    running: list.chats.map((chat) => chat.id).filter((id) => running.includes(id))
  }
}

// Switching chats leaves the others running.
export const selectChat = (docId: DocId, chatId: string): Promise<AgentEntry[]> =>
  openChat(docId, chatId)

export async function deleteChat(docId: DocId, chatId: string): Promise<void> {
  endChatConversation(chatId)
  await removeChat(docId, chatId)
}

// The tab closed (an agent run on it would keep spending usage on edits that
// can no longer land); its chats are kept with the design file.
export async function closeAgentConversations(docId: DocId): Promise<void> {
  for (const provider of Object.values(providers)) {
    for (const chat of provider.conversations()) {
      if (chat.docId === docId) provider.reset(chat.chatId)
    }
  }
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
  // A chat from an earlier launch: the copy kept with it.
  const kept = await chatImage(id)
  if (kept) return kept
  throw new Error('This image is no longer available.')
}

export function shutdownAgents(): void {
  for (const provider of Object.values(providers)) provider.shutdown()
}
