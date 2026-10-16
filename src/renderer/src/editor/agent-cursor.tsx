import { useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { agentActivity, type Activity, type ActivityTarget } from './agent-activity'
import { agent } from './agent-model'
import { elementRect, pageRect, type ScreenRect } from './canvas-rects'
import type { DesignStore } from './store'
import { tabs } from './tabs-model'

// The agents' cursors over the canvas, one per AI panel chat (plus one for
// agents connected from outside): each glides to whatever its agent reads or
// changes, with a name tag saying what it does, and briefly outlines it (a
// scan sweep for reads). Pointer-transparent; motion respects the
// reduced-motion setting (see index.css).

// Boxes are relative to the overlay; the cursor points at the last target
// (the most recent thing touched). `seq` is the activity they were measured
// for: a new one keeps the cursor where it was until its targets show up.
// `flip`: near the right edge, the tag goes left of the cursor.
type Geometry = { boxes: ScreenRect[]; x: number; y: number; seq: number; flip: boolean }

const EDGE = 12
// About the widest tag (max-w-64 plus the arrow).
const TAG_ROOM = 270

function targetRect(root: Element, store: DesignStore, target: ActivityTarget): ScreenRect | null {
  if (target.kind === 'element') return elementRect(root, store, target.id)
  if (target.kind === 'page') return pageRect(root, target.id)
  return target.rect
}

function same(a: Geometry | null, b: Geometry): boolean {
  const round = (g: Geometry): string =>
    [g.seq, g.x, g.y, ...g.boxes.flatMap((r) => [r.x, r.y, r.width, r.height])]
      .map(Math.round)
      .join()
  return !!a && round(a) === round(b)
}

// Shown while its command is fresh, or while its chat still works.
function isVisible(activity: Activity): boolean {
  return !activity.stale || agent.isChatRunning(activity.chatId ?? null)
}

export const AgentCursor = observer(function AgentCursor(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const docId = tabs.activeDocId
  const store = tabs.active?.store
  const activities = docId ? agentActivity.get(docId) : []
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    setOverlay(ref.current)
    agentActivity.root = ref.current?.parentElement ?? null
    return () => {
      agentActivity.root = null
    }
  }, [])

  // Two chats at work on one design: each tag also says which chat it is.
  const shown = activities.filter(isVisible)
  const named = shown.filter((activity) => activity.chatId).length > 1
  const title = (chatId: string): string => {
    const text = (docId && agent.chats(docId).find((chat) => chat.id === chatId)?.title) || 'Chat'
    return text.length > 36 ? `${text.slice(0, 35)}…` : text
  }

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
    >
      {overlay &&
        store &&
        activities.map((activity) => (
          <Cursor
            key={activity.chatId ?? ''}
            activity={activity}
            store={store}
            overlay={overlay}
            visible={isVisible(activity)}
            chat={named && activity.chatId ? title(activity.chatId) : undefined}
          />
        ))}
    </div>
  )
})

const Cursor = observer(function Cursor({
  activity,
  store,
  overlay,
  visible,
  chat
}: {
  activity: Activity
  store: DesignStore
  overlay: HTMLDivElement
  visible: boolean
  // The chat's title, when the design has more than one cursor from chats.
  chat?: string
}): React.JSX.Element | null {
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  // Follows the targets every frame while shown: the user may scroll or zoom,
  // and an element may still be moving (a later command, the user).
  useEffect(() => {
    const root = overlay.parentElement
    if (!visible || !root) return
    let frame = 0
    const tick = (): void => {
      const bounds = overlay.getBoundingClientRect()
      const boxes = activity.targets
        .map((target) => targetRect(root, store, target))
        .filter((rect): rect is ScreenRect => !!rect)
        .map((rect) => ({ ...rect, x: rect.x - bounds.left, y: rect.y - bounds.top }))
      setGeometry((previous) => {
        const last = boxes.at(-1)
        if (!last) return previous
        const clamp = (value: number, max: number): number =>
          Math.min(Math.max(value, EDGE), max - EDGE)
        const next = {
          boxes,
          x: clamp(last.x + last.width / 2, bounds.width),
          y: clamp(last.y + last.height / 2, bounds.height),
          seq: activity.seq,
          flip: last.x + last.width / 2 > bounds.width - TAG_ROOM
        }
        return same(previous, next) ? previous : next
      })
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [visible, activity, store, overlay])

  if (!geometry) return null
  const boxes = visible && !activity.stale && geometry.seq === activity.seq ? geometry.boxes : []
  const label = activity.stale ? activity.agent : `${activity.agent} · ${activity.label}`

  return (
    <div style={{ '--agent-color': activity.color } as React.CSSProperties}>
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
      <div
        className={`agent-cursor absolute top-0 left-0 flex items-start ${geometry.flip ? 'flex-row-reverse' : ''}`}
        style={{
          // Flipped, the arrow (18px wide, now at the right end) stays on the point.
          transform: `translate(${geometry.x}px, ${geometry.y}px)${geometry.flip ? ' translateX(calc(-100% + 18px))' : ''}`,
          opacity: visible ? 1 : 0
        }}
      >
        <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
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
            (geometry.flip ? 'mt-4 -mr-1 ' : 'mt-4 -ml-1 ') +
            'flex max-w-64 flex-col px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white shadow-sm ' +
            (chat ? 'rounded-lg' : 'rounded-full')
          }
          style={{ background: 'var(--agent-color)' }}
        >
          <span className="truncate">{label}</span>
          {chat && <span className="truncate text-[10px] font-normal opacity-85">{chat}</span>}
        </span>
      </div>
    </div>
  )
})
