import { observer } from 'mobx-react-lite'
import { Plus, X } from 'lucide-react'
import { tabs } from './tabs-model'
import { requestCloseTab } from './document'
import { ExportMenu } from './export-menu'
import { ConnectPanel } from './connect-panel'

const isMac = window.desktop.platform === 'darwin'

// Doubles as the window title bar (frameless window): the empty area drags
// the window; tabs and buttons opt out. On macOS the traffic lights sit in
// the reserved left inset.
export const TabStrip = observer(function TabStrip(): React.JSX.Element {
  return (
    <div
      className={
        'app-drag flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 bg-neutral-100 pr-2 dark:border-neutral-800 dark:bg-neutral-900 ' +
        (isMac ? 'pl-20' : 'pl-2')
      }
    >
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-1">
        {tabs.tabs.map((tab) => {
          const isActive = tab.docId === tabs.activeDocId
          return (
            <div
              key={tab.docId}
              role="tab"
              aria-selected={isActive}
              onClick={() => tabs.activate(tab.docId)}
              className={
                'group flex h-7 max-w-48 min-w-10 flex-1 cursor-default items-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors select-none ' +
                (isActive
                  ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-50'
                  : 'text-neutral-500 hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200')
              }
            >
              <span className="min-w-0 flex-1 truncate">{tab.name}</span>
              {tab.dirty && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
              <button
                aria-label={`Close ${tab.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  void requestCloseTab(tab.docId)
                }}
                className={
                  '-mr-1.5 shrink-0 rounded-sm p-0.5 transition-opacity ' +
                  (isActive
                    ? 'opacity-60 hover:bg-neutral-200 hover:opacity-100 dark:hover:bg-neutral-700'
                    : 'opacity-0 group-hover:opacity-60 hover:!opacity-100 hover:bg-neutral-300/70 dark:hover:bg-neutral-700')
                }
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
        <button
          aria-label="New design"
          onClick={() => tabs.newTab()}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <div className="app-no-drag ml-auto flex shrink-0 items-center gap-2">
        <ConnectPanel />
        <ExportMenu />
      </div>
    </div>
  )
})
