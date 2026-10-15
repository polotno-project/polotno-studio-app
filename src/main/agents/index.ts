import type { AgentId, AgentInfo, AgentModels, AgentStatus } from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'
import { claudeProvider } from './claude/provider'
import { codexProvider } from './codex/provider'
import { emitAgentEvent, type AgentProvider } from './provider'
import { readSetting, writeSetting } from './settings'

// The agents the AI panel can run, and which one it runs (kept across
// launches). Each design's conversation lives in the agent that started it.

const providers: Record<AgentId, AgentProvider> = { codex: codexProvider, claude: claudeProvider }
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

// A note in each design whose conversation is dropped, so the history above
// it reads right.
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
    `Switched to ${providers[id].info.name}. The next message starts a new conversation.`
  )
}

export const getAgentStatus = async (): Promise<AgentStatus> => (await current()).getStatus()
export const signInToAgent = async (): Promise<void> => (await current()).signIn()
export const getAgentModels = async (): Promise<AgentModels> => (await current()).getModels()
export const setAgentModel = async (model: string | null): Promise<void> =>
  (await current()).setModel(model)
export const runAgent = async (docId: DocId, prompt: string): Promise<void> =>
  (await current()).run(docId, prompt)

export async function stopAgent(docId: DocId): Promise<void> {
  await Promise.all(Object.values(providers).map((provider) => provider.stop(docId)))
}

export function resetAgent(docId: DocId): void {
  for (const provider of Object.values(providers)) provider.reset(docId)
}

// The MCP token was rotated: every conversation still holds the old one.
export function resetAllAgents(): void {
  for (const provider of Object.values(providers)) {
    endConversations(
      provider,
      'The connection token changed, so the next prompt starts a new conversation.'
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
