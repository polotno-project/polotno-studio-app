import { makeAutoObservable } from 'mobx'
import type {
  AgentEntry,
  AgentEvent,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentStatus
} from '../../../shared/agent'
import type { DocId } from '../../../shared/types'
import { tabs } from './tabs-model'

// Renderer-side state for the AI panel: the running agent's status plus each
// design's conversation feed. Lives outside the panel so switching side-panel
// sections or tabs keeps the history.

class AgentModel {
  active: AgentId = 'codex'
  agents: AgentInfo[] = [{ id: 'codex', name: 'Codex' }]
  status: AgentStatus = { state: 'starting' }
  models: AgentModels = { models: [], selected: null }
  private feeds = new Map<DocId, AgentEntry[]>()
  private running = new Set<DocId>()

  constructor() {
    makeAutoObservable(this)
    window.desktop.on('agent:event', (event) => this.apply(event))
    tabs.addCloseListener((docId) => this.forget(docId))
    void window.desktop.invoke('agent:list').then((list) => this.setAgents(list))
  }

  setAgents({ active, agents }: { active: AgentId; agents: AgentInfo[] }): void {
    this.active = active
    this.agents = agents
  }

  // The agent's display name ("Codex").
  get name(): string {
    return this.agents.find((agent) => agent.id === this.active)?.name ?? this.active
  }

  // The tab is gone (main has already stopped its run).
  forget(docId: DocId): void {
    this.feeds.delete(docId)
    this.running.delete(docId)
  }

  feed(docId: DocId): AgentEntry[] {
    return this.feeds.get(docId) ?? []
  }

  isRunning(docId: DocId): boolean {
    return this.running.has(docId)
  }

  refreshStatus(): void {
    void window.desktop.invoke('agent:status').then((status) => this.setStatus(status))
  }

  setStatus(status: AgentStatus): void {
    this.status = status
    if (status.state === 'ready' && !this.models.models.length) this.loadModels()
  }

  loadModels(): void {
    void window.desktop.invoke('agent:models').then((models) => this.setModels(models))
  }

  setModels(models: AgentModels): void {
    this.models = models
  }

  // The model that runs: the pick, or the agent's default.
  get currentModel(): AgentModels['models'][number] | undefined {
    const { models, selected } = this.models
    return models.find((model) => model.id === selected) ?? models.find((model) => model.isDefault)
  }

  pickModel(id: string | null): void {
    this.models = { ...this.models, selected: id }
    void window.desktop.invoke('agent:setModel', { model: id })
  }

  clear(docId: DocId): void {
    this.feeds.delete(docId)
    void window.desktop.invoke('agent:reset', { docId })
  }

  apply(event: AgentEvent): void {
    if (event.type === 'status') {
      // Other agents report too (Codex runs the canvas AI tools).
      if (event.agent === this.active) this.setStatus(event.status)
    } else if (event.type === 'turn') {
      if (event.state === 'running') this.running.add(event.docId)
      else this.running.delete(event.docId)
    } else {
      const feed = this.feeds.get(event.docId) ?? []
      const index = feed.findIndex((entry) => entry.id === event.entry.id)
      // Updates of a known item (deltas, completion) replace it in place.
      if (index >= 0) feed[index] = { ...feed[index], ...event.entry } as AgentEntry
      else feed.push(event.entry)
      this.feeds.set(event.docId, feed)
    }
  }
}

export const agent = new AgentModel()
