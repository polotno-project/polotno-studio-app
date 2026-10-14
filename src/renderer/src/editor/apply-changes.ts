import { isEqual, type DesignChange } from '../../../shared/design-diff'
import type { DesignStore } from './store'

// Applies an agent's patch (already diffed into per-id changes by the MCP
// server) to the live store, as one undo step. Elements are only touched
// where the agent changed them, so the user's own edits made while the agent
// worked stay. A property the user changed since the agent read the design
// keeps the user's value and is reported back as skipped.

export type SkippedChange = { id: string; props?: string[]; reason: string }

type Parent = {
  id: string
  children: { id: string }[]
  addElement?: (attrs: Record<string, unknown>, options?: { skipSelect?: boolean }) => unknown
}

function parentOf(store: DesignStore, id: string): Parent | undefined {
  return (store.pages.find((page) => page.id === id) ?? store.getElementById(id)) as unknown as
    Parent | undefined
}

// Props that still hold the value the agent saw; the rest the user changed.
function unchangedProps(
  live: Record<string, unknown>,
  change: Extract<DesignChange, { kind: 'set' }>
): { apply: Record<string, unknown>; conflicts: string[] } {
  const apply: Record<string, unknown> = {}
  const conflicts: string[] = []
  for (const [key, value] of Object.entries(change.props)) {
    if (isEqual(live[key], change.base[key]) || isEqual(live[key], value)) apply[key] = value
    else conflicts.push(key)
  }
  return { apply, conflicts }
}

export async function applyChanges(
  store: DesignStore,
  changes: DesignChange[]
): Promise<{ skipped: SkippedChange[] }> {
  const skipped: SkippedChange[] = []

  await store.history.transaction(() => {
    for (const change of changes) {
      switch (change.kind) {
        case 'size': {
          const sizeIsBase =
            store.width === change.base.width && store.height === change.base.height
          if (sizeIsBase) store.setSize(change.width, change.height)
          else
            skipped.push({
              id: 'design',
              props: ['width', 'height'],
              reason: 'resized by the user'
            })
          break
        }
        case 'set': {
          const node =
            change.target === 'page'
              ? store.pages.find((page) => page.id === change.id)
              : store.getElementById(change.id)
          if (!node) {
            skipped.push({ id: change.id, reason: 'deleted by the user' })
            break
          }
          const live = node.toJSON() as Record<string, unknown>
          const { apply, conflicts } = unchangedProps(live, change)
          if (Object.keys(apply).length) node.set(apply)
          if (conflicts.length) {
            skipped.push({ id: change.id, props: conflicts, reason: 'changed by the user' })
          }
          break
        }
        case 'remove-element':
          if (store.getElementById(change.id)) store.deleteElements([change.id])
          break
        case 'add-element': {
          const parent = parentOf(store, change.parentId)
          if (!parent?.addElement) {
            skipped.push({ id: String(change.element.id), reason: 'its page or group is gone' })
            break
          }
          parent.addElement(change.element, { skipSelect: true })
          break
        }
        case 'order': {
          // The agent's elements take the agent's order within the slots
          // they occupy; ones the user added meanwhile stay where they are.
          const parent = parentOf(store, change.parentId)
          if (!parent) break
          const current = parent.children.map((child) => child.id)
          const known = new Set(change.ids)
          const wanted = change.ids.filter((id) => current.includes(id))
          let next = 0
          const final = current.map((id) => (known.has(id) ? wanted[next++] : id))
          final.forEach((id, i) => {
            if (parent.children[i]?.id !== id) store.getElementById(id)?.setZIndex(i)
          })
          break
        }
        case 'remove-page':
          if (store.pages.some((page) => page.id === change.id)) store.deletePages([change.id])
          break
        case 'add-page':
          store.addPage(change.page as Parameters<DesignStore['addPage']>[0])
          break
        case 'page-order':
          change.ids
            .filter((id) => store.pages.some((page) => page.id === id))
            .forEach((id, i) => store.pages.find((page) => page.id === id)?.setZIndex(i))
          break
      }
    }
  })
  await store.waitLoading()
  return { skipped }
}
