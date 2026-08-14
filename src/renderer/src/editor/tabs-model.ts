import { makeAutoObservable, runInAction } from 'mobx'
import type { DocId } from '../../../shared/types'
import { createDesignStore, type DesignStore } from './store'

export interface DesignTab {
  docId: DocId
  store: DesignStore
  filePath: string | null
  name: string
  dirty: boolean
  // Serialized design at last load/save; dirty = snapshot differs from it.
  baseline: string
  // True while an untitled tab has an autosaved draft file on disk.
  hasDraft: boolean
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

  constructor() {
    makeAutoObservable(this, { addCreateListener: false }, { autoBind: true })
  }

  // session.ts subscribes to attach dirty-tracking/autosave to every new tab.
  addCreateListener(listener: (tab: DesignTab) => void): void {
    this.createListeners.push(listener)
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
      dirty: false,
      baseline: '',
      hasDraft: false
    }
    if (json) {
      tab.store.loadJSON(json)
    }
    tab.baseline = designSnapshot(tab.store)
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
    void window.desktop.invoke('doc:setDirty', { docId, dirty })
  }

  closeTab(docId: DocId): void {
    const index = this.tabs.findIndex((tab) => tab.docId === docId)
    if (index === -1) return
    runInAction(() => {
      this.tabs.splice(index, 1)
      if (this.activeDocId === docId) {
        const next = this.tabs[index] ?? this.tabs[index - 1] ?? null
        this.activeDocId = next?.docId ?? null
      }
    })
    void window.desktop.invoke('doc:close', { docId })
    // The editor always shows a design; an empty tab strip gets a fresh one.
    if (this.tabs.length === 0) this.newTab()
  }
}

export const tabs = new TabsModel()
