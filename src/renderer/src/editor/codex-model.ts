import { makeAutoObservable } from 'mobx'
import type { CodexEntry, CodexEvent, CodexModels, CodexStatus } from '../../../shared/codex'
import type { DocId } from '../../../shared/types'
import { tabs } from './tabs-model'

// Renderer-side state for the AI panel: Codex status plus each design's
// conversation feed. Lives outside the panel so switching side-panel sections
// or tabs keeps the history.

class CodexModel {
  status: CodexStatus = { state: 'starting' }
  models: CodexModels = { models: [], selected: null }
  private feeds = new Map<DocId, CodexEntry[]>()
  private running = new Set<DocId>()

  constructor() {
    makeAutoObservable(this)
    window.desktop.on('codex:event', (event) => this.apply(event))
    tabs.addCloseListener((docId) => this.forget(docId))
  }

  // The tab is gone (main has already stopped its run).
  forget(docId: DocId): void {
    this.feeds.delete(docId)
    this.running.delete(docId)
  }

  feed(docId: DocId): CodexEntry[] {
    return this.feeds.get(docId) ?? []
  }

  isRunning(docId: DocId): boolean {
    return this.running.has(docId)
  }

  refreshStatus(): void {
    void window.desktop.invoke('codex:status').then((status) => this.setStatus(status))
  }

  setStatus(status: CodexStatus): void {
    this.status = status
    if (status.state === 'ready' && !this.models.models.length) this.loadModels()
  }

  loadModels(): void {
    void window.desktop.invoke('codex:models').then((models) => this.setModels(models))
  }

  setModels(models: CodexModels): void {
    this.models = models
  }

  // The model that runs: the pick, or Codex's default.
  get currentModel(): CodexModels['models'][number] | undefined {
    const { models, selected } = this.models
    return models.find((model) => model.id === selected) ?? models.find((model) => model.isDefault)
  }

  pickModel(id: string | null): void {
    this.models = { ...this.models, selected: id }
    void window.desktop.invoke('codex:setModel', { model: id })
  }

  clear(docId: DocId): void {
    this.feeds.delete(docId)
    void window.desktop.invoke('codex:reset', { docId })
  }

  apply(event: CodexEvent): void {
    if (event.type === 'status') {
      this.setStatus(event.status)
    } else if (event.type === 'turn') {
      if (event.state === 'running') this.running.add(event.docId)
      else this.running.delete(event.docId)
    } else {
      const feed = this.feeds.get(event.docId) ?? []
      const index = feed.findIndex((entry) => entry.id === event.entry.id)
      // Updates of a known item (deltas, completion) replace it in place.
      if (index >= 0) feed[index] = { ...feed[index], ...event.entry } as CodexEntry
      else feed.push(event.entry)
      this.feeds.set(event.docId, feed)
    }
  }
}

export const codex = new CodexModel()
