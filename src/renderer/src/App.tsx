import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { PolotnoEditor } from './editor/polotno-editor'
import { TabStrip } from './editor/tab-strip'
import { tabs } from './editor/tabs-model'

const App = observer(function App(): React.JSX.Element {
  useEffect(() => {
    if (tabs.tabs.length === 0) tabs.newTab()
    return window.desktop.on('menu:action', ({ action }) => {
      switch (action) {
        case 'newTab':
          tabs.newTab()
          break
        case 'closeTab':
          if (tabs.activeDocId) tabs.closeTab(tabs.activeDocId)
          break
      }
    })
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
    </div>
  )
})

export default App
