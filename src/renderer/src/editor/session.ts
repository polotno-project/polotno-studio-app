import { toast } from 'sonner'
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

// A programmatic load settles asynchronously (assets, font normalization).
// Re-capture the baseline once loading finishes so none of it counts as dirty.
function settleAfterLoad(tab: DesignTab): void {
  void tab.store
    .waitLoading()
    .catch(() => undefined)
    .finally(() => {
      tab.baseline = designSnapshot(tab.store)
      tab.loading = false
      tabs.setDirty(tab.docId, false)
    })
}

function attach(tab: DesignTab): void {
  if (tab.loading) settleAfterLoad(tab)
  let dirtyTimer: ReturnType<typeof setTimeout> | undefined
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  tab.store.on('change', () => {
    if (tab.loading) return
    clearTimeout(dirtyTimer)
    dirtyTimer = setTimeout(() => {
      if (tab.loading) return
      const dirty = designSnapshot(tab.store) !== tab.baseline
      tabs.setDirty(tab.docId, dirty)
      if (!dirty) return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void autosave(tab), AUTOSAVE_DEBOUNCE_MS)
    }, DIRTY_DEBOUNCE_MS)
  })
}

tabs.addCreateListener(attach)

// The file changed on disk under an open tab. Clean tab: reload silently.
// Dirty tab: the user picks (native dialog). "Keep mine" leaves the in-memory
// design as the source of truth — the next autosave overwrites the file.
async function handleExternalChange(docId: string): Promise<void> {
  const tab = tabs.get(docId)
  if (!tab?.filePath) return
  const dirty = designSnapshot(tab.store) !== tab.baseline || tab.dirty
  if (dirty) {
    const choice = await window.desktop.invoke('dialog:externalChange', { name: tab.name })
    if (choice === 'keep') return
  }
  try {
    const { content } = await window.desktop.invoke('file:read', { filePath: tab.filePath })
    tab.loading = true
    tab.store.loadJSON(JSON.parse(content))
    settleAfterLoad(tab)
    toast.info(`Reloaded "${tab.name}" from disk`)
  } catch (error) {
    console.error('Failed to reload after external change', error)
    toast.error(`Could not reload "${tab.name}" from disk.`)
  }
}

window.desktop.on('doc:externalChange', ({ docId }) => {
  void handleExternalChange(docId)
})

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
