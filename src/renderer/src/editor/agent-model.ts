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
// design's chats and their feeds. A design's chats run side by side; the
// panel shows the open one. Main keeps the chats (with the
// design file); this mirrors them, loaded when a design's panel first shows.

class AgentModel {
  active: AgentId = 'codex'
  agents: AgentInfo[] = [
    { id: 'codex', name: 'Codex' },
    { id: 'claude', name: 'Claude' }
  ]
  status: AgentStatus = { state: 'starting' }
  // Codex's own status, whichever agent chats: the canvas AI tools run on it.
  // Null until something asks (asking starts Codex).
  codexStatus: AgentStatus | null = null
  models: AgentModels = { models: [], selected: null }
  // By chat id: every chat this window has loaded or seen events for.
  private feeds = new Map<string, AgentEntry[]>()
  private chatLists = new Map<DocId, { chats: ChatSummary[]; activeId: string | null }>()
  // Running chats, by chat id, with their design.
  private running = new Map<string, DocId>()

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

  // The tab is gone (main has already stopped its runs).
  forget(docId: DocId): void {
    for (const chat of this.chats(docId)) this.feeds.delete(chat.id)
    this.chatLists.delete(docId)
    for (const [chatId, owner] of this.running) if (owner === docId) this.running.delete(chatId)
  }

  // The design's chats from main, with the open chat's feed and which chats
  // are working.
  loadChats(docId: DocId): void {
    void window.desktop
      .invoke('agent:chats', { docId })
      .then(({ chats, activeId, entries, running }) => {
        this.setChats(docId, chats, activeId)
        if (activeId) this.setFeed(activeId, entries)
        this.setRunning(docId, running)
      })
  }

  setChats(docId: DocId, chats: ChatSummary[], activeId: string | null): void {
    this.chatLists.set(docId, { chats, activeId })
  }

  // Main's copy of a chat's feed, merged with the live entries this window
  // already has for it (they may be newer than main's copy, or arrive while
  // it is on its way).
  setFeed(chatId: string, entries: AgentEntry[]): void {
    const local = this.feeds.get(chatId) ?? []
    const byId = new Map(local.map((entry) => [entry.id, entry]))
    const known = new Set(entries.map((entry) => entry.id))
    this.feeds.set(chatId, [
      ...entries.map((entry) => byId.get(entry.id) ?? entry),
      ...local.filter((entry) => !known.has(entry.id))
    ])
  }

  setRunning(docId: DocId, chatIds: string[]): void {
    for (const [chatId, owner] of this.running) if (owner === docId) this.running.delete(chatId)
    for (const chatId of chatIds) this.running.set(chatId, docId)
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

  // Opens another chat; a running one keeps running.
  selectChat(docId: DocId, chatId: string): void {
    this.setChats(docId, this.chats(docId), chatId)
    void window.desktop
      .invoke('agent:selectChat', { docId, chatId })
      .then((entries) => this.setFeed(chatId, entries))
  }

  deleteChat(docId: DocId, chatId: string): void {
    void window.desktop.invoke('agent:deleteChat', { docId, chatId })
  }

  // The open chat's feed.
  feed(docId: DocId): AgentEntry[] {
    const chatId = this.activeChat(docId)
    return (chatId && this.feeds.get(chatId)) || []
  }

  // Any of the design's chats is working (the canvas shows the agent).
  isRunning(docId: DocId): boolean {
    return [...this.running.values()].includes(docId)
  }

  isChatRunning(chatId: string | null): boolean {
    return !!chatId && this.running.has(chatId)
  }

  // A message to the open chat (main opens a new one if none is).
  send(docId: DocId, prompt: string): Promise<void> {
    return window.desktop.invoke('agent:run', { docId, prompt }).then((chatId) => {
      if (this.activeChat(docId) === null) this.setChats(docId, this.chats(docId), chatId)
    })
  }

  stop(docId: DocId): void {
    const chatId = this.activeChat(docId)
    if (chatId) void window.desktop.invoke('agent:stop', { chatId })
  }

  // Main answers for whichever agent is active when the request lands: an
  // answer that comes back after a switch belongs to the old one.
  refreshStatus(): void {
    const asked = this.active
    void window.desktop.invoke('agent:status').then((status) => {
      if (asked === this.active) this.setStatus(status)
    })
  }

  setStatus(status: AgentStatus): void {
    this.status = status
    if (status.state === 'ready' && !this.models.models.length) this.loadModels()
  }

  loadModels(): void {
    const asked = this.active
    void window.desktop.invoke('agent:models').then((models) => {
      if (asked === this.active) this.setModels(models)
    })
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

  refreshCodexStatus(): void {
    void window.desktop.invoke('imageEdit:status').then((status) => this.setCodexStatus(status))
  }

  setCodexStatus(status: AgentStatus): void {
    this.codexStatus = status
  }

  // New chat: the open one stays in the list, running if it was.
  clear(docId: DocId): void {
    this.setChats(docId, this.chats(docId), null)
    void window.desktop.invoke('agent:reset', { docId })
  }

  apply(event: AgentEvent): void {
    if (event.type === 'status') {
      // Other agents report too (Codex runs the canvas AI tools).
      if (event.agent === this.active) this.setStatus(event.status)
      if (event.agent === 'codex') this.codexStatus = event.status
    } else if (event.type === 'chats') {
      if (this.isLoaded(event.docId)) this.loadChats(event.docId)
    } else if (event.type === 'turn') {
      if (event.state === 'running') this.running.set(event.chatId, event.docId)
      else this.running.delete(event.chatId)
    } else {
      // Every chat's entries are kept, open or not: switching to a running
      // chat shows it live.
      const feed = this.feeds.get(event.chatId) ?? []
      const index = feed.findIndex((entry) => entry.id === event.entry.id)
      // Updates of a known item (deltas, completion) replace it in place.
      if (index >= 0) feed[index] = { ...feed[index], ...event.entry } as AgentEntry
      else feed.push(event.entry)
      this.feeds.set(event.chatId, feed)
    }
  }
}

export const agent = new AgentModel()
