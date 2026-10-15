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
