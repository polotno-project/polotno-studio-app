import { isDeepStrictEqual as isEqual } from 'node:util'
import type { DesignDefaults } from './commands'

// The design as agents read it: every property still at Polotno's default is
// left out, and long fractions are rounded. A full store.toJSON() spells out
// some 50 properties per element, most of them defaults, which multiplies the
// tokens of every read and makes a few-page design too big for an agent to
// read at all. Patches still apply to the full copy the agent read, and only
// leaf properties are dropped (never array items), so JSON Patch paths into
// the compact copy mean the same in the full one.

type Json = Record<string, unknown>

// Kept even at their default: an element's identity and box.
const ALWAYS = new Set(['id', 'type', 'children', 'x', 'y', 'width', 'height', 'text'])

function round(value: unknown): unknown {
  if (typeof value === 'number' && !Number.isInteger(value)) return Math.round(value * 100) / 100
  if (Array.isArray(value)) return value.map(round)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, round(v)]))
  }
  return value
}

function compactElement(element: Json, defaults: DesignDefaults): Json {
  const base = defaults.elements[element.type as string] ?? {}
  const out: Json = {}
  for (const [key, value] of Object.entries(element)) {
    if (key === 'children' && Array.isArray(value)) {
      out.children = (value as Json[]).map((child) => compactElement(child, defaults))
    } else if (ALWAYS.has(key) || !(key in base) || !isEqual(value, base[key])) {
      out[key] = round(value)
    }
  }
  return out
}

export function compactDesign<T>(design: T, defaults: DesignDefaults): T {
  const full = design as Json & { pages?: Json[] }
  if (!Array.isArray(full.pages)) return design
  const pages = full.pages.map((page) => {
    const out: Json = {}
    for (const [key, value] of Object.entries(page)) {
      if (key === 'children' && Array.isArray(value)) {
        out.children = (value as Json[]).map((child) => compactElement(child, defaults))
      } else if (key === 'id' || !(key in defaults.page) || !isEqual(value, defaults.page[key])) {
        out[key] = round(value)
      }
    }
    return out
  })
  return { ...full, pages } as T
}

// A design too big for one tool result (many pages) is read a few pages at a
// time: the pages asked for come in full, every other page as an outline
// under `outline` instead of `children`, one line per element in children
// order: "<id> <type> <x>,<y> <width>x<height> \"text…\"". Pages keep their
// array positions, so a patch path like /pages/3/children/2 still means the
// same element. With `brief`, outlined pages only count their elements.

const SNIPPET = 40

function outlineElement(element: Json): string {
  const parts = [element.id, element.type]
  // Polotno's own names ("text-4") say nothing the type doesn't.
  if (typeof element.name === 'string' && element.name && !/^[a-z]+-\d+$/.test(element.name)) {
    parts.push(`[${element.name}]`)
  }
  const box = ['x', 'y', 'width', 'height'].map((key) => Math.round(Number(element[key]) || 0))
  parts.push(`${box[0]},${box[1]}`, `${box[2]}x${box[3]}`)
  if (Array.isArray(element.children)) parts.push(`(${element.children.length} elements)`)
  if (typeof element.text === 'string') {
    const text = element.text
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    parts.push(JSON.stringify(text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text))
  }
  return parts.join(' ')
}

export function outlineDesign<T>(
  design: T,
  fullPages: (pageId: string, index: number) => boolean,
  { brief = false }: { brief?: boolean } = {}
): T {
  const full = design as Json & { pages?: Json[] }
  if (!Array.isArray(full.pages)) return design
  const pages = full.pages.map((page, index) => {
    if (fullPages(page.id as string, index)) return page
    const { children, ...rest } = page
    const elements = Array.isArray(children) ? (children as Json[]) : []
    return brief
      ? { ...rest, outlined: true, elementCount: elements.length }
      : { ...rest, outlined: true, outline: elements.map(outlineElement) }
  })
  return { ...full, pages } as T
}
