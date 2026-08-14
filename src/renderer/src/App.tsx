import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Toaster } from 'sonner'
import { PolotnoEditor } from './editor/polotno-editor'
import { HiddenStages } from './editor/hidden-stages'
import { TabStrip } from './editor/tab-strip'
import { tabs } from './editor/tabs-model'
import { openViaDialog, requestCloseTab, saveTab, saveTabAs } from './editor/document'
import { restoreDrafts } from './editor/session'

const App = observer(function App(): React.JSX.Element {
  useEffect(() => {
    void restoreDrafts().then((restored) => {
      if (restored === 0 && tabs.tabs.length === 0) tabs.newTab()
      // Tell main the doc:openPath listener below is live (flushes OS opens).
      void window.desktop.invoke('app:rendererReady')
    })
    const offMenu = window.desktop.on('menu:action', ({ action }) => {
      switch (action) {
        case 'newTab':
          tabs.newTab()
          break
        case 'closeTab':
          if (tabs.activeDocId) void requestCloseTab(tabs.activeDocId)
          break
        case 'openFile':
          void openViaDialog()
          break
        case 'save':
          if (tabs.activeDocId) void saveTab(tabs.activeDocId)
          break
        case 'saveAs':
          if (tabs.activeDocId) void saveTabAs(tabs.activeDocId)
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
