import { createStore } from 'polotno/model/store'
import type { DesignDefaults } from '../../../shared/commands'
import { POLOTNO_KEY } from './polotno-key'

// What Polotno fills in for a page and for each element type when nothing is
// set: read from a throwaway store, so it follows the installed Polotno.
// get_design_json leaves these values out of what agents read.

const TYPES = ['text', 'image', 'svg', 'figure', 'line', 'group', 'video', 'gif', 'table']

let cached: DesignDefaults | null = null

export function designDefaults(): DesignDefaults {
  if (cached) return cached
  const store = createStore({ key: POLOTNO_KEY, showCredit: false })
  const page = store.addPage()
  const elements: DesignDefaults['elements'] = {}
  for (const type of TYPES) {
    try {
      const element = page.addElement({ type }, { skipSelect: true })
      // Its id and generated name ("text-1") are not defaults; no name is.
      const json = element.toJSON() as Record<string, unknown>
      delete json.id
      elements[type] = { ...json, name: '' }
    } catch {
      // A type this Polotno doesn't have.
    }
  }
  const pageJson = page.toJSON() as Record<string, unknown>
  delete pageJson.id
  delete pageJson.children
  cached = { page: pageJson, elements }
  return cached
}
