import { tabs, designSnapshot, type DesignTab } from './tabs-model'
import { saveTab } from './document'

// Ported pattern from studio-automation editor-session.tsx: a 400 ms dirty
// recompute on store change, and a 1 s coalesced autosave. File-backed tabs
// autosave to their real file; untitled tabs autosave to a draft.

const DIRTY_DEBOUNCE_MS = 400
const AUTOSAVE_DEBOUNCE_MS = 1000

async function autosave(tab: DesignTab): Promise<void> {
  if (!tabs.get(tab.docId)) return // tab was closed meanwhile
  if (tab.filePath) {
    await saveTab(tab.docId)
    return
  }
  const content = designSnapshot(tab.store)
  if (content === tab.baseline && !tab.dirty) return
  await window.desktop.invoke('draft:write', { docId: tab.docId, content })
  tab.hasDraft = true
}

function attach(tab: DesignTab): void {
  let dirtyTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  tab.store.on('change', () => {
    clearTimeout(dirtyTimer)
    dirtyTimer = setTimeout(() => {
      const dirty = designSnapshot(tab.store) !== tab.baseline
      tabs.setDirty(tab.docId, dirty)
      if (!dirty) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void autosave(tab), AUTOSAVE_DEBOUNCE_MS)
    }, DIRTY_DEBOUNCE_MS)
  })
}

tabs.addCreateListener(attach)

// Window is closing: persist everything, then let main proceed.
window.desktop.on('app:flushRequest', () => {
  void (async () => {
    for (const tab of [...tabs.tabs]) {
      try {
        if (designSnapshot(tab.store) !== tab.baseline || tab.dirty) {
          await autosave(tab)
        }
      } catch (error) {
        console.error('Flush failed for tab', tab.name, error)
      }
    }
    window.desktop.send('app:flushDone', {})
  })()
})

// Reopen drafts from the previous session as untitled tabs. The draft is
// re-keyed to the new tab's docId; the old file is removed only after the
// new one is safely written.
let draftsRestored = false

export async function restoreDrafts(): Promise<number> {
  // React StrictMode double-invokes effects; drafts must restore only once.
  if (draftsRestored) return 0
  draftsRestored = true
  const drafts = await window.desktop.invoke('draft:list')
  let restored = 0
  for (const draft of drafts) {
    try {
      const json = JSON.parse(draft.content)
      const tab = tabs.newTab({ json, activate: restored === 0 })
      await window.desktop.invoke('draft:write', { docId: tab.docId, content: draft.content })
      tab.hasDraft = true
      await window.desktop.invoke('draft:remove', { docId: draft.docId })
      restored++
    } catch (error) {
      console.error('Failed to restore draft', draft.docId, error)
    }
  }
  return restored
}
