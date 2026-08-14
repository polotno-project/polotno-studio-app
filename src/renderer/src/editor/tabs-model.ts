import { makeAutoObservable, runInAction } from 'mobx'
import type { DocId } from '../../../shared/types'
import { createDesignStore, type DesignStore } from './store'

export interface DesignTab {
  docId: DocId
  store: DesignStore
  filePath: string | null
  name: string
  dirty: boolean
}

function nameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath
  return base.replace(/\.(polotno|json)$/i, '')
}

// One live Polotno store per open tab. Stores stay alive across tab switches
// (undo history lives in the store), while only the active one has a mounted
// editor. The bridge executor (stage-1 step 14) looks stores up here by docId.
class TabsModel {
  tabs: DesignTab[] = []
  activeDocId: DocId | null = null

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
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

  newTab(options: { filePath?: string | null; json?: unknown; activate?: boolean } = {}): DesignTab {
    const { filePath = null, json, activate = true } = options
    const tab: DesignTab = {
      docId: crypto.randomUUID(),
      store: createDesignStore(),
      filePath,
      name: filePath ? nameFromPath(filePath) : 'Untitled',
      dirty: false
    }
    if (json) {
      tab.store.loadJSON(json)
    }
    this.tabs.push(tab)
    if (activate || this.tabs.length === 1) this.activeDocId = tab.docId
    void window.desktop.invoke('doc:register', { docId: tab.docId, filePath })
    return tab
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
