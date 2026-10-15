import { useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { agentActivity, type ActivityTarget } from './agent-activity'
import { agent } from './agent-model'
import { elementRect, pageRect, type ScreenRect } from './canvas-rects'
import type { DesignStore } from './store'
import { tabs } from './tabs-model'

// The agent's cursor over the canvas: it glides to whatever the agent reads
// or changes, with a name tag saying what it does, and briefly outlines it
// (a scan sweep for reads). Pointer-transparent; motion respects the
// reduced-motion setting (see index.css).

// Boxes are relative to the overlay; the cursor points at the last target
// (the most recent thing touched). `seq` is the activity they were measured
// for: a new one keeps the cursor where it was until its targets show up.
type Geometry = { boxes: ScreenRect[]; x: number; y: number; seq: number }

const EDGE = 12

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

export const AgentCursor = observer(function AgentCursor(): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const docId = tabs.activeDocId
  const store = tabs.active?.store
  const activity = docId ? agentActivity.get(docId) : undefined
  const working = !!docId && agent.isRunning(docId)
  const visible = !!activity && (!activity.stale || working)
  const [geometry, setGeometry] = useState<Geometry | null>(null)

  useEffect(() => {
    agentActivity.root = ref.current?.parentElement ?? null
    return () => {
      agentActivity.root = null
    }
  }, [])

  // Follows the targets every frame while shown: the user may scroll or zoom,
  // and an element may still be moving (a later command, the user).
  useEffect(() => {
    const overlay = ref.current
    const root = overlay?.parentElement
    if (!visible || !activity || !store || !overlay || !root) return
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
          seq: activity.seq
        }
        return same(previous, next) ? previous : next
      })
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [visible, activity, store])

  const boxes =
    visible && activity && !activity.stale && geometry?.seq === activity.seq ? geometry.boxes : []
  const label =
    activity && !activity.stale ? `${activity.agent} · ${activity.label}` : activity?.agent

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
      style={{ '--agent-color': '#7c3aed' } as React.CSSProperties}
    >
      {boxes.map((box, index) => (
        <div
          key={`${activity?.seq}:${index}`}
          className={activity?.mode === 'read' ? 'agent-scan' : 'agent-highlight'}
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
      {geometry && (
        <div
          className="agent-cursor absolute top-0 left-0 flex items-start"
          style={{
            transform: `translate(${geometry.x}px, ${geometry.y}px)`,
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
            className="mt-4 -ml-1 max-w-64 truncate rounded-full px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap text-white shadow-sm"
            style={{ background: 'var(--agent-color)' }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  )
})
