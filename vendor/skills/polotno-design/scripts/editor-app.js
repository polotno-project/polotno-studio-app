// Source for the local editor page (bundled by build-editor.mjs, served by
// serve.js). A full Polotno editor bound to the served design file:
// reloads on external file changes, saves the human's edits back.
import { createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno'
import { createStore } from 'polotno/model/store'
import { setAnimationsEnabled } from 'polotno/config'
import { Workspace } from 'polotno/canvas/workspace'
import { DEFAULT_SECTIONS, SidePanel, VariablesSection } from 'polotno/side-panel'
import { Toolbar } from 'polotno/toolbar/toolbar'
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons'
import { PagesTimeline } from 'polotno/pages-timeline'

const store = createStore({ key: window.__POLOTNO_KEY__, showCredit: true })
// Exposed for debugging and for polotno-node's client contract
// (createInstance({ url }) can point at this page).
window.store = store

const usesTime = (design) =>
  design.audios?.length > 0 || /"(animations|type)":\s*(\[\s*\{|"video")/.test(JSON.stringify(design))

let loading = false
let dirty = false
let saveTimer = null

async function load() {
  loading = true
  try {
    const design = await (await fetch('/design.json')).json()
    // The editor hides its animation UI unless this flag is on. A static design
    // keeps the plain editor.
    if (usesTime(design)) setAnimationsEnabled(true)
    store.loadJSON(design)
    await store.waitLoading()
  } finally {
    loading = false
    dirty = false
  }
}

async function save() {
  const body = JSON.stringify(store.toJSON(), null, 2)
  await fetch('/design.json', { method: 'POST', body })
  dirty = false
}

store.on('change', () => {
  if (loading) return
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save().catch(console.error), 800)
})

new EventSource('/events').onmessage = () => {
  // Unsaved human edits win; the agent re-reads the file before writing.
  if (dirty) return
  load().catch(console.error)
}

await load()

createRoot(document.getElementById('root')).render(
  h(
    PolotnoContainer,
    { style: { width: '100vw', height: '100vh' } },
    // The Variables section is opt-in: it lets the human edit template values.
    h(SidePanelWrap, null, h(SidePanel, { store, sections: [...DEFAULT_SECTIONS, VariablesSection] })),
    h(
      WorkspaceWrap,
      null,
      h(Toolbar, { store }),
      h(Workspace, { store }),
      h(ZoomButtons, { store }),
      h(PagesTimeline, { store })
    )
  )
)
