import { toast } from 'sonner'
import type { DocId } from '../../../shared/types'
import { tabs, designSnapshot, type DesignTab } from './tabs-model'

// Everything about a design's relationship to its file: what counts as
// unsaved, when the file is written, and what happens when it changes
// underneath us. Nothing outside this module decides any of that.
//
// Ported pattern from studio-automation editor-session.tsx: a 400 ms dirty
// recompute on store change, and a 1 s coalesced autosave straight to the
// design's file, plus a thumbnail sidecar for the My designs panel.

const DIRTY_DEBOUNCE_MS = 400
const AUTOSAVE_DEBOUNCE_MS = 1000
const PREVIEW_WIDTH = 240

interface PersistenceState {
  // Serialized design at last load/save; dirty = snapshot differs from it.
  baseline: string
  // True while a programmatic load settles (loadJSON + async asset loading).
  // Change events during a load must not mark the tab dirty (studio's
  // loadingRef pattern) — otherwise autosave overwrites external edits.
  loading: boolean
  dirtyTimer?: ReturnType<typeof setTimeout>
  saveTimer?: ReturnType<typeof setTimeout>
  // The in-flight library:create, so two overlapping saves cannot make two
  // library files for one design.
  materializing?: Promise<void>
}

// Keyed by docId rather than held on DesignTab: none of it is rendered, so
// none of it belongs in an observable the UI reads.
const states = new Map<DocId, PersistenceState>()

async function writePreview(tab: DesignTab): Promise<void> {
  try {
    const dataUrl = await tab.store.toDataURL({
      pixelRatio: PREVIEW_WIDTH / tab.store.width,
      mimeType: 'image/jpeg',
      quality: 0.7
    })
    await window.desktop.invoke('design:writePreview', { docId: tab.docId, dataUrl })
  } catch {
    // thumbnails are best-effort
  }
}

// A load settles asynchronously (assets, font normalization). Re-capture the
// baseline once it finishes so none of it counts as dirty. An empty store
// resolves immediately, so every tab takes this path.
function settle(tab: DesignTab): void {
  const state = states.get(tab.docId)
  if (!state) return
  state.loading = true
  void tab.store
    .waitLoading()
    .catch(() => undefined)
    .finally(() => {
      const current = states.get(tab.docId)
      if (!current) return // detached while loading
      current.baseline = designSnapshot(tab.store)
      current.loading = false
      tabs.setDirty(tab.docId, false)
      void writePreview(tab)
    })
}

export function attach(tab: DesignTab): void {
  if (states.has(tab.docId)) return
  states.set(tab.docId, { baseline: designSnapshot(tab.store), loading: false })
  settle(tab)

  // The handler re-reads the state map every time, so a detached tab stops
  // doing work without needing the store listener removed.
  tab.store.on('change', () => {
    const state = states.get(tab.docId)
    if (!state || state.loading) return
    clearTimeout(state.dirtyTimer)
    state.dirtyTimer = setTimeout(() => {
      const current = states.get(tab.docId)
      if (!current || current.loading) return
      const dirty = designSnapshot(tab.store) !== current.baseline
      tabs.setDirty(tab.docId, dirty)
      if (!dirty) return
      clearTimeout(current.saveTimer)
      current.saveTimer = setTimeout(() => void autosave(tab), AUTOSAVE_DEBOUNCE_MS)
    }, DIRTY_DEBOUNCE_MS)
  })
}

// Cancels any pending autosave, so a design deleted from My designs cannot be
// resurrected by a timer that was already in flight.
export function detach(docId: DocId): void {
  const state = states.get(docId)
  if (!state) return
  clearTimeout(state.dirtyTimer)
  clearTimeout(state.saveTimer)
  states.delete(docId)
}

export function isDirty(tab: DesignTab): boolean {
  const state = states.get(tab.docId)
  if (!state) return false
  return designSnapshot(tab.store) !== state.baseline || tab.dirty
}

// Give the design a real file in the library folder (Documents/Polotno).
// A design materializes when it has something worth keeping — the first save,
// or an explicit import — never just because a tab was opened. A blank tab the
// user never touched leaves nothing behind, so closing and reopening tabs
// cannot fill "My designs" with empty designs.
export function materialize(tab: DesignTab): Promise<void> {
  const state = states.get(tab.docId)
  if (!state || tab.filePath) return Promise.resolve()
  state.materializing ??= window.desktop
    .invoke('library:create', { name: tab.name, content: designSnapshot(tab.store) })
    .then(({ filePath }) => {
      tabs.setFilePath(tab.docId, filePath)
    })
    .catch((error) => {
      state.materializing = undefined // let the next save try again
      throw error
    })
  return state.materializing
}

async function writeTo(tab: DesignTab, filePath: string): Promise<boolean> {
  const content = designSnapshot(tab.store)
  await window.desktop.invoke('file:write', { docId: tab.docId, filePath, content })
  const state = states.get(tab.docId)
  if (state) state.baseline = content
  tabs.setDirty(tab.docId, false)
  return true
}

// Saving never asks the user where: every design belongs to the library, so a
// design with no file yet gets one here. Save As stays an explicit menu action
// for writing a copy somewhere else.
export async function save(docId: DocId): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  await materialize(tab)
  if (!tab.filePath) return false // no longer tracked
  return writeTo(tab, tab.filePath)
}

export async function saveAs(docId: DocId): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  const result = await window.desktop.invoke('file:saveAsDialog', { suggestedName: tab.name })
  if (!result) return false
  tabs.setFilePath(docId, result.filePath)
  return writeTo(tab, result.filePath)
}

// The caller is a timer, so nothing is waiting to catch this.
async function autosave(tab: DesignTab): Promise<void> {
  if (!states.has(tab.docId)) return // detached meanwhile
  try {
    await save(tab.docId)
    await writePreview(tab)
  } catch (error) {
    console.error('Autosave failed for tab', tab.name, error)
  }
}

async function flushAll(): Promise<void> {
  for (const tab of [...tabs.tabs]) {
    try {
      if (isDirty(tab)) await save(tab.docId)
    } catch (error) {
      console.error('Flush failed for tab', tab.name, error)
    }
  }
}

// The file changed on disk under an open tab. Clean tab: reload silently.
// Dirty tab: the user picks (native dialog). "Keep mine" leaves the in-memory
// design as the source of truth — the next autosave overwrites the file.
async function handleExternalChange(docId: DocId): Promise<void> {
  const tab = tabs.get(docId)
  if (!tab?.filePath) return
  if (isDirty(tab)) {
    const choice = await window.desktop.invoke('dialog:externalChange', { name: tab.name })
    if (choice === 'keep') return
  }
  try {
    const { content } = await window.desktop.invoke('file:read', { filePath: tab.filePath })
    tab.store.loadJSON(JSON.parse(content))
    settle(tab)
    toast.info(`Reloaded "${tab.name}" from disk`)
  } catch (error) {
    console.error('Failed to reload after external change', error)
    toast.error(`Could not reload "${tab.name}" from disk.`)
  }
}

let initialized = false

// Wired explicitly at startup. Previously these subscriptions ran as a side
// effect of importing the module, so autosave silently depended on someone
// importing it for an unrelated reason.
export function initPersistence(): void {
  if (initialized) return
  initialized = true

  tabs.addCreateListener(attach)
  tabs.addCloseListener(detach)

  window.desktop.on('doc:externalChange', ({ docId }) => {
    void handleExternalChange(docId)
  })

  // Window is closing: persist everything, then let main proceed. Main falls
  // back to a 3 s timeout, so answering even on failure closes the window
  // promptly instead of stalling it.
  window.desktop.on('app:flushRequest', () => {
    void flushAll()
      .catch((error) => console.error('Flush failed', error))
      .finally(() => window.desktop.send('app:flushDone', {}))
  })
}
