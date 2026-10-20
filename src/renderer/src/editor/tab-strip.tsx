import { useRef } from 'react'
import { DragDropProvider, KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { isSortable, useSortable } from '@dnd-kit/react/sortable'
import { PointerActivationConstraints } from '@dnd-kit/dom'
import { RestrictToElement } from '@dnd-kit/dom/modifiers'
import { RestrictToHorizontalAxis } from '@dnd-kit/abstract/modifiers'
import { observer } from 'mobx-react-lite'
import { Menu, Plus, X } from 'lucide-react'
import { PolotnoScope } from 'polotno/primitives/portal-scope'
import { tabs, type DesignTab } from './tabs-model'
import { requestCloseTab } from './document'
import { ExportMenu } from './export-menu'
import { ConnectPanel } from './connect-panel'

const isMac = window.desktop.platform === 'darwin'
// Windows and Linux have no menu bar in this window (hidden title bar on
// Windows, auto-hidden menu bar on Linux); this button opens the same
// application menu as a popup.
const hasMenuButton = !isMac

// Pointer travel before a press on a tab becomes a drag, so clicks that wobble
// a pixel or two still just switch tabs.
const SENSORS = [
  PointerSensor.configure({
    activationConstraints: [new PointerActivationConstraints.Distance({ value: 4 })]
  }),
  KeyboardSensor
]

const SortableTab = observer(function SortableTab({
  tab,
  index,
  list
}: {
  tab: DesignTab
  index: number
  list: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  // The dragged tab slides along the strip only; it may follow the pointer
  // out of the window, but stays drawn inside the tab list.
  const { ref } = useSortable({
    id: tab.docId,
    index,
    modifiers: [
      RestrictToHorizontalAxis,
      RestrictToElement.configure({ element: () => list.current })
    ]
  })
  const isActive = tab.docId === tabs.activeDocId
  return (
    <div
      ref={ref}
      role="tab"
      aria-selected={isActive}
      onClick={() => tabs.activate(tab.docId)}
      className={
        'app-no-drag group flex h-7 max-w-48 min-w-10 flex-1 cursor-default items-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap transition-colors select-none ' +
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
})

// Doubles as the window title bar (frameless window): the empty area drags
// the window; tabs and buttons opt out. On macOS the traffic lights sit in
// the reserved left inset.
export const TabStrip = observer(function TabStrip(): React.JSX.Element {
  const actionsRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  return (
    <div
      className={
        'app-drag window-controls-inset flex h-10 shrink-0 items-center gap-1 border-b border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900 ' +
        (isMac ? 'pl-20' : 'pl-2')
      }
    >
      {hasMenuButton && (
        <button
          aria-label="Menu"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            void window.desktop.invoke('app:showMenu', {
              x: Math.round(rect.left),
              y: Math.round(rect.bottom)
            })
          }}
          className="app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Menu className="size-4" />
        </button>
      )}
      <div ref={listRef} className="relative flex min-w-0 flex-1 items-center gap-1">
        {/* Optimistic sorting moves the tabs while dragging; the model
            follows on drop, which also tells main the new order. */}
        <DragDropProvider
          sensors={SENSORS}
          onDragStart={({ operation }) => {
            if (operation.source) tabs.activate(String(operation.source.id))
          }}
          onDragEnd={({ operation, canceled }) => {
            const { source } = operation
            if (canceled || !isSortable(source) || source.initialIndex === source.index) return
            tabs.moveTab(String(source.id), source.index)
          }}
        >
          {tabs.tabs.map((tab, index) => (
            <SortableTab key={tab.docId} tab={tab} index={index} list={listRef} />
          ))}
        </DragDropProvider>
        <button
          aria-label="New design"
          onClick={() => tabs.newTab()}
          className="app-no-drag flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/60 dark:hover:text-neutral-200"
        >
          <Plus className="size-4" />
        </button>
      </div>
      {/* Outside the editor's PolotnoContainer, Polotno dialogs and menus read
          the theme once when they mount; PolotnoScope keeps them following it. */}
      <div ref={actionsRef} className="app-no-drag ml-auto flex shrink-0 items-center gap-2">
        <PolotnoScope elementRef={actionsRef}>
          <ConnectPanel />
          <ExportMenu />
        </PolotnoScope>
      </div>
    </div>
  )
})
