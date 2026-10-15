import { makeAutoObservable } from 'mobx'
import type {
  AgentEntry,
  AgentEvent,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentStatus,
  ChatSummary
} from '../../../shared/agent'
import type { DocId } from '../../../shared/types'
import { tabs } from './tabs-model'

// Renderer-side state for the AI panel: the running agent's status plus each
// design's chats and the open chat's feed. Main keeps the chats (with the
// design file); this mirrors them, loaded when a design's panel first shows.

class AgentModel {
  active: AgentId = 'codex'
  agents: AgentInfo[] = [
    { id: 'codex', name: 'Codex' },
    { id: 'claude', name: 'Claude' }
  ]
  status: AgentStatus = { state: 'starting' }
  models: AgentModels = { models: [], selected: null }
  private feeds = new Map<DocId, AgentEntry[]>()
  private chatLists = new Map<DocId, { chats: ChatSummary[]; activeId: string | null }>()
  private running = new Set<DocId>()

  constructor() {
    makeAutoObservable(this)
    window.desktop.on('agent:event', (event) => this.apply(event))
    tabs.addCloseListener((docId) => this.forget(docId))
    void window.desktop.invoke('agent:list').then((list) => this.setAgents(list))
  }

  setAgents({ active, agents }: { active: AgentId; agents: AgentInfo[] }): void {
    this.agents = agents
    if (active === this.active) return
    this.active = active
    this.models = { models: [], selected: null }
    this.refreshStatus()
  }

  // Ends the agent conversations (main adds a note to each chat); the new
  // agent reads the chat before the next message.
  setActive(id: AgentId): void {
    if (id === this.active) return
    this.active = id
    this.status = { state: 'starting' }
    this.models = { models: [], selected: null }
    void window.desktop.invoke('agent:setActive', { agent: id }).then(() => this.refreshStatus())
  }

  // The agent's display name ("Codex").
  get name(): string {
    return this.agents.find((agent) => agent.id === this.active)?.name ?? this.active
  }

  // The tab is gone (main has already stopped its run).
  forget(docId: DocId): void {
    this.feeds.delete(docId)
    this.chatLists.delete(docId)
    this.running.delete(docId)
  }

  // The design's chats from main; the feed too unless `keepFeed` (the open
  // chat didn't change, and its live entries are already here).
  loadChats(docId: DocId, keepFeed = false): void {
    void window.desktop.invoke('agent:chats', { docId }).then(({ chats, activeId, entries }) => {
      const sameChat = this.chatLists.get(docId)?.activeId === activeId
      this.setChats(docId, chats, activeId, keepFeed && sameChat ? undefined : entries)
    })
  }

  setChats(
    docId: DocId,
    chats: ChatSummary[],
    activeId: string | null,
    entries?: AgentEntry[]
  ): void {
    this.chatLists.set(docId, { chats, activeId })
    if (entries) this.feeds.set(docId, entries)
  }

  chats(docId: DocId): ChatSummary[] {
    return this.chatLists.get(docId)?.chats ?? []
  }

  activeChat(docId: DocId): string | null {
    return this.chatLists.get(docId)?.activeId ?? null
  }

  isLoaded(docId: DocId): boolean {
    return this.chatLists.has(docId)
  }

  selectChat(docId: DocId, chatId: string): void {
    void window.desktop
      .invoke('agent:selectChat', { docId, chatId })
      .then((entries) => this.setChats(docId, this.chats(docId), chatId, entries))
  }

  deleteChat(docId: DocId, chatId: string): void {
    void window.desktop.invoke('agent:deleteChat', { docId, chatId })
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

  // New chat: the open one stays in the list.
  clear(docId: DocId): void {
    this.feeds.delete(docId)
    void window.desktop.invoke('agent:reset', { docId })
  }

  apply(event: AgentEvent): void {
    if (event.type === 'status') {
      // Other agents report too (Codex runs the canvas AI tools).
      if (event.agent === this.active) this.setStatus(event.status)
    } else if (event.type === 'chats') {
      if (this.isLoaded(event.docId)) this.loadChats(event.docId, true)
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
