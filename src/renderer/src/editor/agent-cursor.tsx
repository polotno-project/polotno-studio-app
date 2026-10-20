import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { PageControls } from 'polotno/canvas/page-controls'
import { agentActivity, type Activity, type ActivityTarget } from './agent-activity'
import { agent } from './agent-model'
import { elementBox, pageBox, type Box } from './page-boxes'
import type { DesignStore } from './store'
import { tabs } from './tabs-model'

// The agents' cursors on the canvas, one per AI panel chat (plus one for
// agents connected from outside): each glides to whatever its agent reads or
// changes, with a name tag saying what it does, and briefly outlines it (a
// scan sweep for reads). They live in each page's slot of the workspace
// (Polotno's PageControls), placed in page units, so they stay on their
// element as the user scrolls or zooms and follow it as it moves. A cursor
// going to another page appears there. Pointer-transparent; motion respects
// the reduced-motion setting (see index.css).

// The glide's length in index.css (.agent-cursor).
const GLIDE_MS = 450
// About the widest tag (max-w-64 plus the arrow), and the tallest (two lines
// below the arrow).
const TAG_ROOM = 270
const TAG_DROP = 56

type PageType = DesignStore['pages'][number]

type SlotProps = {
  store: DesignStore
  page: PageType
  xPadding: number
  yPadding: number
  layout?: 'vertical' | 'horizontal'
}

function locate(store: DesignStore, target: ActivityTarget): { pageId: string; box: Box } | null {
  if (target.kind === 'element') return elementBox(store, target.id)
  if (target.kind === 'rect') return { pageId: target.pageId, box: target.rect }
  const box = pageBox(store, target.id)
  return box && { pageId: target.id, box }
}

// Shown while its command is fresh, or while its chat still works.
function isVisible(activity: Activity): boolean {
  return !activity.stale || agent.isChatRunning(activity.chatId ?? null)
}

const AgentLayer = observer(function AgentLayer({
  store,
  page,
  xPadding,
  yPadding
}: SlotProps): React.JSX.Element | null {
  const docId = tabs.tabs.find((tab) => tab.store === store)?.docId
  const activities = docId ? agentActivity.get(docId) : []
  if (!docId || !activities.length) return null

  const scale = store.scale
  const bleed = store.bleedVisible ? page.computedBleed : { left: 0, top: 0, right: 0, bottom: 0 }
  const width = xPadding * 2 + (page.computedWidth + bleed.left + bleed.right) * scale
  const height = yPadding * 2 + (page.computedHeight + bleed.top + bleed.bottom) * scale
  // Page units to this slot's pixels.
  const place = (box: Box): Box => ({
    x: xPadding + (bleed.left + box.x) * scale,
    y: yPadding + (bleed.top + box.y) * scale,
    width: box.width * scale,
    height: box.height * scale
  })
  const here = (target: ActivityTarget | undefined): Box | null => {
    const found = target && locate(store, target)
    return found?.pageId === page.id ? place(found.box) : null
  }

  // Two chats at work on one design: each tag also says which chat it is.
  const named = activities.filter((item) => isVisible(item) && item.chatId).length > 1
  const title = (chatId: string): string => {
    const text = agent.chats(docId).find((chat) => chat.id === chatId)?.title || 'Chat'
    return text.length > 36 ? `${text.slice(0, 35)}…` : text
  }

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {activities.map((activity) => {
        const visible = isVisible(activity)
        const boxes =
          visible && !activity.stale
            ? activity.targets.map(here).filter((box): box is Box => !!box)
            : []
        const point = here(activity.anchor)
        return (
          <div
            key={activity.chatId ?? ''}
            style={{ '--agent-color': activity.color } as React.CSSProperties}
          >
            {boxes.map((box, index) => (
              <div
                key={`${activity.seq}:${index}`}
                className={activity.mode === 'read' ? 'agent-scan' : 'agent-highlight'}
                style={{
                  position: 'absolute',
                  left: box.x - 3,
                  top: box.y - 3,
                  width: box.width + 6,
                  height: box.height + 6,
                  borderRadius: 4
                }}
              />
            ))}
            {point && (
              <Cursor
                activity={activity}
                x={point.x + point.width / 2}
                y={point.y + point.height / 2}
                flip={point.x + point.width / 2 > width - TAG_ROOM}
                lift={point.y + point.height / 2 > height - TAG_DROP}
                visible={visible}
                chat={named && activity.chatId ? title(activity.chatId) : undefined}
              />
            )}
          </div>
        )
      })}
    </div>
  )
})

// The arrow on the point; the tag goes left of it near the right edge
// (`flip`) and above it near the bottom (`lift`), where the page's slot ends.
function Cursor({
  activity,
  x,
  y,
  flip,
  lift,
  visible,
  chat
}: {
  activity: Activity
  x: number
  y: number
  flip: boolean
  lift: boolean
  visible: boolean
  // The chat's title, when the design has more than one cursor from chats.
  chat?: string
}): React.JSX.Element {
  // Glides to a new command's target; once there (a zoom, the element
  // dragged) it moves with the canvas at once.
  const [settled, setSettled] = useState(activity.seq)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(activity.seq), GLIDE_MS)
    return () => clearTimeout(timer)
  }, [activity.seq])
  const gliding = settled !== activity.seq
  const label = activity.stale ? activity.agent : `${activity.agent} · ${activity.label}`

  return (
    <div
      className="agent-cursor absolute top-0 left-0"
      style={{
        transform: `translate(${x}px, ${y}px)`,
        opacity: visible ? 1 : 0,
        ...(!gliding && { transition: 'opacity 300ms ease-out' })
      }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="block drop-shadow-sm">
        <path
          d="M1.5 1.5 L16 9.2 L9.2 10.9 L5.9 17.5 Z"
          fill="var(--agent-color)"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={
          'absolute flex max-w-64 flex-col px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white shadow-sm ' +
          (chat ? 'rounded-lg' : 'rounded-full')
        }
        style={{
          background: 'var(--agent-color)',
          ...(flip ? { right: 18 } : { left: 14 }),
          ...(lift ? { bottom: 22 } : { top: 16 })
        }}
      >
        <span className="truncate">{label}</span>
        {chat && <span className="truncate text-[10px] font-normal opacity-85">{chat}</span>}
      </span>
    </div>
  )
}

// Polotno's page controls, with the agent cursors over the page: for
// <Workspace components={{ PageControls }}>.
export function PageSlot(props: SlotProps): React.JSX.Element {
  return (
    <>
      <PageControls {...props} />
      <AgentLayer {...props} />
    </>
  )
}
