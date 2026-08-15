import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Toaster } from 'sonner'
import { PolotnoEditor } from './editor/polotno-editor'
import { HiddenStages } from './editor/hidden-stages'
import { TabStrip } from './editor/tab-strip'
import { tabs } from './editor/tabs-model'
import { createDesign, openViaDialog, requestCloseTab, restoreSession } from './editor/document'
import { initPersistence, save, saveAs } from './editor/persistence'

const App = observer(function App(): React.JSX.Element {
  useEffect(() => {
    // Explicit: dirty-tracking and autosave must not depend on some other
    // module happening to import persistence.ts.
    initPersistence()
    void restoreSession().then(() => {
      // Tell main the doc:openPath listener below is live (flushes OS opens).
      void window.desktop.invoke('app:rendererReady')
    })
    const offMenu = window.desktop.on('menu:action', ({ action }) => {
      switch (action) {
        case 'newTab':
          void createDesign()
          break
        case 'closeTab':
          if (tabs.activeDocId) void requestCloseTab(tabs.activeDocId)
          break
        case 'openFile':
          void openViaDialog()
          break
        case 'save':
          if (tabs.activeDocId) void save(tabs.activeDocId)
          break
        case 'saveAs':
          if (tabs.activeDocId) void saveAs(tabs.activeDocId)
          break
        case 'export':
          void import('./editor/export-menu').then(({ runExport }) => runExport('png'))
          break
      }
    })
    const offOpen = window.desktop.on('doc:openPath', ({ filePath }) => {
      void import('./editor/document').then(({ openPath }) => openPath(filePath))
    })
    return () => {
      offMenu()
      offOpen()
    }
  }, [])

  const active = tabs.active
  return (
    <div className="flex h-full flex-col">
      <TabStrip />
      <div className="min-h-0 flex-1">
        {/* key remounts the editor per tab; the store (and its undo history)
            lives in the tab and survives the remount. */}
        {active && <PolotnoEditor key={active.docId} store={active.store} />}
      </div>
      <HiddenStages />
      <Toaster richColors position="bottom-right" />
    </div>
  )
})

export default App
