// Turns "the design before" and "the design after" an agent's JSON Patch into
// the smallest set of store operations, keyed by element and page id. The
// renderer applies them to the live store instead of reloading the whole
// design, so whatever the user changed meanwhile (moved a text, typed into it)
// survives. Each property change carries the value the agent saw, so the
// renderer can tell when the user changed that same property since.

type Json = Record<string, unknown>
type Node = Json & { id: string; children?: Node[] }
type Design = Json & { pages: Node[] }

export type DesignChange =
  // Changed properties of an element or page; `base` holds what the agent saw.
  | { kind: 'set'; target: 'element' | 'page'; id: string; props: Json; base: Json }
  | { kind: 'add-element'; parentId: string; element: Json }
  | { kind: 'remove-element'; id: string }
  // The agent's order of a page's (or group's) children, by id.
  | { kind: 'order'; parentId: string; ids: string[] }
  | { kind: 'add-page'; page: Json }
  | { kind: 'remove-page'; id: string }
  | { kind: 'page-order'; ids: string[] }
  | {
      kind: 'size'
      width: number
      height: number
      base: { width: number; height: number }
    }

// Edits this diff does not map to store operations; the caller falls back to
// loading the whole design.
export type DiffResult = { changes: DesignChange[] } | { fallback: string }

export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, i) => isEqual(value, other[i]))
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => isEqual((a as Json)[key], (b as Json)[key]))
  )
}

// Property-level differences, ignoring id and the children array (structure
// is diffed separately). A removed key becomes undefined.
function propChanges(before: Json, after: Json): { props: Json; base: Json } | null {
  const props: Json = {}
  const base: Json = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'id' || key === 'children') continue
    if (!isEqual(before[key], after[key])) {
      props[key] = after[key]
      base[key] = before[key]
    }
  }
  return Object.keys(props).length ? { props, base } : null
}

// Every element by id, with the id of its parent (a page or a group).
function index(design: Design): Map<string, { node: Node; parentId: string }> {
  const map = new Map<string, { node: Node; parentId: string }>()
  const walk = (children: Node[] | undefined, parentId: string): void => {
    for (const child of children ?? []) {
      map.set(child.id, { node: child, parentId })
      walk(child.children, child.id)
    }
  }
  for (const page of design.pages) walk(page.children, page.id)
  return map
}

function childIds(node: { children?: Node[] }): string[] {
  return (node.children ?? []).map((child) => child.id)
}

export function diffDesign(before: Design, after: Design): DiffResult {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'pages' || key === 'width' || key === 'height') continue
    if (!isEqual(before[key], after[key])) return { fallback: `design "${key}" changed` }
  }

  const changes: DesignChange[] = []
  if (before.width !== after.width || before.height !== after.height) {
    changes.push({
      kind: 'size',
      width: after.width as number,
      height: after.height as number,
      base: { width: before.width as number, height: before.height as number }
    })
  }

  // Pages: removed, added (whole, with their elements), changed, reordered.
  const pagesBefore = new Map(before.pages.map((page) => [page.id, page]))
  const pagesAfter = new Map(after.pages.map((page) => [page.id, page]))
  for (const page of before.pages) {
    if (!pagesAfter.has(page.id)) changes.push({ kind: 'remove-page', id: page.id })
  }
  for (const page of after.pages) {
    const old = pagesBefore.get(page.id)
    if (!old) {
      changes.push({ kind: 'add-page', page })
      continue
    }
    const diff = propChanges(old, page)
    if (diff) changes.push({ kind: 'set', target: 'page', id: page.id, ...diff })
  }
  // Added pages are appended; anything else needs the agent's order.
  const wantedPages = after.pages.map((page) => page.id)
  const oldOrder = before.pages.filter((page) => pagesAfter.has(page.id)).map((page) => page.id)
  const addedPages = wantedPages.filter((id) => !pagesBefore.has(id))
  if (!isEqual(wantedPages, [...oldOrder, ...addedPages])) {
    changes.push({ kind: 'page-order', ids: wantedPages })
  }

  // Elements on pages that exist on both sides.
  const elementsBefore = index({
    ...before,
    pages: before.pages.filter((p) => pagesAfter.has(p.id))
  })
  const elementsAfter = index({ ...after, pages: after.pages.filter((p) => pagesBefore.has(p.id)) })

  for (const [id, { parentId }] of elementsBefore) {
    if (elementsAfter.has(id)) continue
    // Removing a group removes its children with it.
    const parentRemoved = elementsBefore.has(parentId) && !elementsAfter.has(parentId)
    if (!parentRemoved) changes.push({ kind: 'remove-element', id })
  }

  for (const [id, { node, parentId }] of elementsAfter) {
    const old = elementsBefore.get(id)
    if (!old) {
      // A new element inside a group that is new too arrives with the group.
      if (elementsAfter.has(parentId) && !elementsBefore.has(parentId)) continue
      if (elementsBefore.has(parentId)) return { fallback: 'an element was added inside a group' }
      changes.push({ kind: 'add-element', parentId, element: node })
      continue
    }
    if (old.parentId !== parentId) return { fallback: `element ${id} moved to another parent` }
    if (old.node.type !== node.type) return { fallback: `element ${id} changed type` }
    const diff = propChanges(old.node, node)
    if (diff) changes.push({ kind: 'set', target: 'element', id, ...diff })
  }

  // Order: compare each parent's children (existing ones in their old order,
  // new ones appended) with what the agent wants.
  const parents: { id: string; before?: { children?: Node[] }; after: { children?: Node[] } }[] = [
    ...after.pages
      .filter((page) => pagesBefore.has(page.id))
      .map((page) => ({ id: page.id, before: pagesBefore.get(page.id), after: page })),
    ...[...elementsAfter.values()]
      .filter(({ node }) => node.type === 'group' && elementsBefore.has(node.id))
      .map(({ node }) => ({ id: node.id, before: elementsBefore.get(node.id)!.node, after: node }))
  ]
  for (const parent of parents) {
    const wanted = childIds(parent.after)
    const kept = childIds(parent.before ?? {}).filter((id) => wanted.includes(id))
    const added = wanted.filter((id) => !kept.includes(id))
    if (!isEqual(wanted, [...kept, ...added])) {
      changes.push({ kind: 'order', parentId: parent.id, ids: wanted })
    }
  }

  return { changes }
}
