import Konva from 'konva'
import type { DesignStore } from './store'

// Where design elements and pages are on screen, read from the Konva stages
// Polotno mounts (one per page, tagged with its pageId). Only stages inside
// `root` count: background tabs keep hidden stages of their own. Text has no
// Konva node of its own (Polotno draws it as an anonymous shape), so its box
// comes from the model, placed over its page.

export type ScreenRect = { x: number; y: number; width: number; height: number }

function stagesIn(root: Element): Konva.Stage[] {
  return Konva.stages.filter((stage) => root.contains(stage.container()))
}

function toScreen(stage: Konva.Stage, node: Konva.Node): ScreenRect {
  const box = stage.container().getBoundingClientRect()
  const rect = node.getClientRect()
  return { x: box.left + rect.x, y: box.top + rect.y, width: rect.width, height: rect.height }
}

type ElementBox = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  page?: { id: string; computedWidth: number }
}

// The element's bounding box on its page, rotated about its top-left corner
// like Polotno does, then scaled onto the page's screen rect.
function modelRect(root: Element, element: ElementBox): ScreenRect | null {
  const page = element.page && pageRect(root, element.page.id)
  if (!element.page || !page) return null
  const scale = page.width / element.page.computedWidth
  const angle = (element.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)]
  const corners = [
    [0, 0],
    [element.width, 0],
    [0, element.height],
    [element.width, element.height]
  ].map(([dx, dy]) => ({
    x: element.x + dx * cos - dy * sin,
    y: element.y + dx * sin + dy * cos
  }))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return {
    x: page.x + Math.min(...xs) * scale,
    y: page.y + Math.min(...ys) * scale,
    width: (Math.max(...xs) - Math.min(...xs)) * scale,
    height: (Math.max(...ys) - Math.min(...ys)) * scale
  }
}

export function elementRect(root: Element, store: DesignStore, id: string): ScreenRect | null {
  for (const stage of stagesIn(root)) {
    const node = stage.findOne('#' + id)
    if (node) return toScreen(stage, node)
  }
  const element = store.getElementById(id) as unknown as ElementBox | undefined
  return element ? modelRect(root, element) : null
}

export function pageRect(root: Element, pageId: string): ScreenRect | null {
  const stage = stagesIn(root).find((s) => s.getAttr('pageId') === pageId)
  const background = stage?.findOne('.page-background')
  return stage && background ? toScreen(stage, background) : null
}
