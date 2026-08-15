import { makeAutoObservable, runInAction } from 'mobx'
import type { DocId } from '../../../shared/types'
import { createDesignStore, type DesignStore } from './store'

// Every field here is rendered by the UI. Anything about the design's
// relationship to its file (baseline, load settling, autosave timers) is
// private to persistence.ts.
export interface DesignTab {
  docId: DocId
  store: DesignStore
  filePath: string | null
  name: string
  dirty: boolean
}

export function designSnapshot(store: DesignStore): string {
  return JSON.stringify(store.toJSON())
}

export function nameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.(polotno|json|pdf|ai|svg)$/i, '')
}

// One live Polotno store per open tab. Stores stay alive across tab switches
// (undo history lives in the store), while only the active one has a mounted
// editor. The bridge executor (stage-1 step 14) looks stores up here by docId.
class TabsModel {
  tabs: DesignTab[] = []
  activeDocId: DocId | null = null
  private createListeners: ((tab: DesignTab) => void)[] = []
  private closeListeners: ((docId: DocId) => void)[] = []

  constructor() {
    makeAutoObservable(
      this,
      { addCreateListener: false, addCloseListener: false },
      { autoBind: true }
    )
  }

  // persistence.ts subscribes to both, so a tab picks up dirty-tracking and
  // autosave wherever it was created, and drops them wherever it was closed.
  addCreateListener(listener: (tab: DesignTab) => void): void {
    this.createListeners.push(listener)
  }

  addCloseListener(listener: (docId: DocId) => void): void {
    this.closeListeners.push(listener)
  }

  get active(): DesignTab | null {
    return this.tabs.find((tab) => tab.docId === this.activeDocId) ?? null
  }

  get(docId: DocId): DesignTab | undefined {
    return this.tabs.find((tab) => tab.docId === docId)
  }

  getByPath(filePath: string): DesignTab | undefined {
    return this.tabs.find((tab) => tab.filePath === filePath)
  }

  newTab(
    options: {
      filePath?: string | null
      json?: unknown
      name?: string
      activate?: boolean
    } = {}
  ): DesignTab {
    const { filePath = null, json, name, activate = true } = options
    const tab: DesignTab = {
      docId: crypto.randomUUID(),
      store: createDesignStore(),
      filePath,
      name: name ?? (filePath ? nameFromPath(filePath) : 'Untitled'),
      dirty: false
    }
    if (json) {
      tab.store.loadJSON(json)
    }
    this.tabs.push(tab)
    // mobx wraps the pushed object in an observable proxy; hand out that proxy,
    // not the raw object, so later mutations (baseline, hasDraft) are seen.
    const observableTab = this.tabs[this.tabs.length - 1]
    if (activate || this.tabs.length === 1) this.activeDocId = observableTab.docId
    void window.desktop.invoke('doc:register', { docId: observableTab.docId, filePath })
    for (const listener of this.createListeners) listener(observableTab)
    return observableTab
  }

  activate(docId: DocId): void {
    if (this.get(docId)) this.activeDocId = docId
  }

  setFilePath(docId: DocId, filePath: string): void {
    const tab = this.get(docId)
    if (!tab) return
    tab.filePath = filePath
    tab.name = nameFromPath(filePath)
    void window.desktop.invoke('doc:setFilePath', { docId, filePath })
  }

  setDirty(docId: DocId, dirty: boolean): void {
    const tab = this.get(docId)
    if (!tab || tab.dirty === dirty) return
    tab.dirty = dirty
  }

  closeTab(docId: DocId): void {
    const index = this.tabs.findIndex((tab) => tab.docId === docId)
    if (index === -1) return
    // Before the tab leaves the list, so pending autosaves are cancelled while
    // the tab is still resolvable.
    for (const listener of this.closeListeners) listener(docId)
    runInAction(() => {
      this.tabs.splice(index, 1)
      if (this.activeDocId === docId) {
        const next = this.tabs[index] ?? this.tabs[index - 1] ?? null
        this.activeDocId = next?.docId ?? null
      }
    })
    void window.desktop.invoke('doc:close', { docId })
  }
}

export const tabs = new TabsModel()
