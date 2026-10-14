import type { AgentId, AgentInfo, AgentModels, AgentStatus } from '../../shared/agent'
import type { DocId } from '../../shared/types'
import type { LocalImage } from '../../mcp-server/local-image'
import { codexProvider } from './codex/provider'
import type { AgentProvider } from './provider'

// The agents the AI panel can run, and which one it runs. Each design's
// conversation lives in the agent that started it.

const providers: Record<AgentId, AgentProvider> = { codex: codexProvider }
const active: AgentId = 'codex'

const current = (): AgentProvider => providers[active]

export function listAgents(): { active: AgentId; agents: AgentInfo[] } {
  return { active, agents: Object.values(providers).map((provider) => provider.info) }
}

export const getAgentStatus = (): Promise<AgentStatus> => current().getStatus()
export const signInToAgent = (): Promise<void> => current().signIn()
export const getAgentModels = (): Promise<AgentModels> => current().getModels()
export const setAgentModel = (model: string | null): Promise<void> => current().setModel(model)
export const runAgent = (docId: DocId, prompt: string): Promise<void> =>
  current().run(docId, prompt)

export async function stopAgent(docId: DocId): Promise<void> {
  await Promise.all(Object.values(providers).map((provider) => provider.stop(docId)))
}

export function resetAgent(docId: DocId): void {
  for (const provider of Object.values(providers)) provider.reset(docId)
}

export function resetAllAgents(): void {
  for (const provider of Object.values(providers)) provider.resetAll()
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
