import { observer } from 'mobx-react-lite'
import { Plus, X } from 'lucide-react'
import { tabs } from './tabs-model'
import { requestCloseTab } from './document'
import { ExportMenu } from './export-menu'

export const TabStrip = observer(function TabStrip(): React.JSX.Element {
  return (
    <div className="flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b border-neutral-200 bg-neutral-100 px-1 pt-1 dark:border-neutral-800 dark:bg-neutral-900">
      {tabs.tabs.map((tab) => {
        const isActive = tab.docId === tabs.activeDocId
        return (
          <div
            key={tab.docId}
            role="tab"
            aria-selected={isActive}
            onClick={() => tabs.activate(tab.docId)}
            className={
              'group flex max-w-52 min-w-24 cursor-default items-center gap-1.5 rounded-t-md px-3 text-xs select-none ' +
              (isActive
                ? 'bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800')
            }
          >
            <span className="truncate">{tab.name}</span>
            {tab.dirty && <span className="size-1.5 shrink-0 rounded-full bg-blue-500" />}
            <button
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation()
                void requestCloseTab(tab.docId)
              }}
              className="invisible -mr-1 shrink-0 rounded p-0.5 group-hover:visible hover:bg-neutral-300 dark:hover:bg-neutral-700"
            >
              <X className="size-3" />
            </button>
          </div>
        )
      })}
      <button
        aria-label="New design"
        onClick={() => tabs.newTab()}
        className="ml-1 self-center rounded p-1 text-neutral-500 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        <Plus className="size-4" />
      </button>
      <ExportMenu />
    </div>
  )
})
