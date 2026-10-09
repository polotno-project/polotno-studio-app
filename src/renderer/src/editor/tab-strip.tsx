import { useLayoutEffect, useRef } from 'react'
import { observer } from 'mobx-react-lite'
import { Menu, Plus, X } from 'lucide-react'
import { PolotnoScope } from 'polotno/primitives/portal-scope'
import { tabs } from './tabs-model'
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
const DRAG_THRESHOLD = 4

interface TabDrag {
  docId: string
  pointerId: number
  startX: number
  // Pointer x relative to the tab's left edge when it was grabbed.
  grabX: number
  lastX: number
  dragging: boolean
}

// Doubles as the window title bar (frameless window): the empty area drags
// the window; tabs and buttons opt out. On macOS the traffic lights sit in
// the reserved left inset.
export const TabStrip = observer(function TabStrip(): React.JSX.Element {
  const actionsRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const tabEls = useRef(new Map<string, HTMLDivElement>())
  const drag = useRef<TabDrag | null>(null)

  // Moves the dragged tab off its layout slot to follow the pointer; the other
  // tabs snap into the order it passes over. Written to the DOM directly so a
  // reorder re-render can re-place it before paint (see the layout effect).
  const placeDraggedTab = (): void => {
    const d = drag.current
    const el = d && tabEls.current.get(d.docId)
    const list = listRef.current
    if (!d?.dragging || !el || !list) return
    // offsetLeft is the layout slot; it ignores the transform.
    const slotLeft = list.getBoundingClientRect().left + el.offsetLeft
    const minX = -el.offsetLeft
    const maxX = list.clientWidth - el.offsetLeft - el.offsetWidth
    const x = Math.max(minX, Math.min(maxX, d.lastX - d.grabX - slotLeft))
    el.style.transform = `translateX(${x}px)`
    el.style.position = 'relative'
    el.style.zIndex = '10'
  }

  // Runs after every render, including the one a swap triggers, so the tab
  // never shows one frame at its new slot before jumping back under the pointer.
  useLayoutEffect(placeDraggedTab)

  const endDrag = (): void => {
    const d = drag.current
    drag.current = null
    const el = d && tabEls.current.get(d.docId)
    if (el) {
      el.style.transform = ''
      el.style.position = ''
      el.style.zIndex = ''
    }
  }

  const onTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, docId: string): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    drag.current = {
      docId,
      pointerId: e.pointerId,
      startX: e.clientX,
      grabX: e.clientX - e.currentTarget.getBoundingClientRect().left,
      lastX: e.clientX,
      dragging: false
    }
  }

  const onTabPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    if (!d.dragging) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return
      d.dragging = true
      e.currentTarget.setPointerCapture(e.pointerId)
      tabs.activate(d.docId)
    }
    d.lastX = e.clientX
    placeDraggedTab()

    // Swap with a neighbour once the dragged tab's center passes its center.
    // Unclamped: at either end of the strip the drawn tab stops at the edge,
    // where its center could never get past the end tab's.
    const el = tabEls.current.get(d.docId)
    if (!el) return
    const index = tabs.tabs.findIndex((tab) => tab.docId === d.docId)
    const center = d.lastX - d.grabX + el.offsetWidth / 2
    const neighbourCenter = (i: number): number | null => {
      const neighbour = tabs.tabs[i] && tabEls.current.get(tabs.tabs[i].docId)
      if (!neighbour) return null
      const box = neighbour.getBoundingClientRect()
      return box.left + box.width / 2
    }
    const prev = neighbourCenter(index - 1)
    const next = neighbourCenter(index + 1)
    if (prev !== null && center < prev) tabs.moveTab(d.docId, index - 1)
    else if (next !== null && center > next) tabs.moveTab(d.docId, index + 1)
  }

  const onTabPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return
    endDrag()
  }

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
        {tabs.tabs.map((tab) => {
          const isActive = tab.docId === tabs.activeDocId
          return (
            <div
              key={tab.docId}
              ref={(el) => {
                if (el) tabEls.current.set(tab.docId, el)
                else tabEls.current.delete(tab.docId)
              }}
              role="tab"
              aria-selected={isActive}
              onClick={() => tabs.activate(tab.docId)}
              onPointerDown={(e) => onTabPointerDown(e, tab.docId)}
              onPointerMove={onTabPointerMove}
              onPointerUp={onTabPointerUp}
              onPointerCancel={onTabPointerUp}
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
        })}
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
