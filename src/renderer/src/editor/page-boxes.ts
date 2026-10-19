import { getTotalClientRect } from 'polotno/utils/math'
import type { DesignStore } from './store'

// Where design elements are on their page, in page units, from the model
// (as Polotno's own selection tooltip measures them): the agent cursors
// draw them in each page's slot of the workspace, which Polotno lays out,
// scrolls and zooms.

export type Box = { x: number; y: number; width: number; height: number }

type Shape = {
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  children?: Shape[]
  page?: { id: string }
}

// A group has no box of its own: its children's.
function shapes(node: Shape): Shape[] {
  return node.type === 'group' ? (node.children ?? []).flatMap(shapes) : [node]
}

export function elementBox(store: DesignStore, id: string): { pageId: string; box: Box } | null {
  const element = store.getElementById(id) as unknown as Shape | undefined
  const pageId = element?.page?.id
  const parts = element ? shapes(element) : []
  if (!pageId || !parts.length) return null
  const { x, y, width, height } = getTotalClientRect(parts)
  return { pageId, box: { x, y, width, height } }
}

export function pageBox(store: DesignStore, id: string): Box | null {
  const page = store.pages.find((item) => item.id === id)
  return page ? { x: 0, y: 0, width: page.computedWidth, height: page.computedHeight } : null
}
