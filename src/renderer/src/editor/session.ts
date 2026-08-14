import { toast } from 'sonner'
import { tabs, designSnapshot, type DesignTab } from './tabs-model'
import { saveTab, openPath, createDesign } from './document'

// Ported pattern from studio-automation editor-session.tsx: a 400 ms dirty
// recompute on store change, and a 1 s coalesced autosave straight to the
// design's file, plus a thumbnail sidecar for the My designs panel.

const DIRTY_DEBOUNCE_MS = 400
const AUTOSAVE_DEBOUNCE_MS = 1000
const PREVIEW_WIDTH = 240

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

async function autosave(tab: DesignTab): Promise<void> {
  if (!tabs.get(tab.docId)) return // tab was closed meanwhile
  if (!tab.filePath) return // file still materializing (createDesign in flight)
  await saveTab(tab.docId)
  void writePreview(tab)
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
      void writePreview(tab)
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
        if (tab.filePath && (designSnapshot(tab.store) !== tab.baseline || tab.dirty)) {
          await saveTab(tab.docId)
        }
      } catch (error) {
        console.error('Flush failed for tab', tab.name, error)
      }
    }
    window.desktop.send('app:flushDone', {})
  })()
})

let sessionRestored = false

// Reopen the files that were open when the app last closed; a fresh install
// (or empty session) starts with one new library design.
export async function restoreSession(): Promise<void> {
  // React StrictMode double-invokes effects; restore only once.
  if (sessionRestored) return
  sessionRestored = true
  const { filePaths } = await window.desktop.invoke('session:list')
  for (const filePath of filePaths) {
    await openPath(filePath)
  }
  if (tabs.tabs.length === 0) await createDesign()
}
