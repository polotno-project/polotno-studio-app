import { toast } from 'sonner'
import { tabs, nameFromPath, type DesignTab } from './tabs-model'
import { kindFromPath, parseProjectText, parsePdfBuffer, parseSvgText } from './import-design'
import { isDirty, materialize, save } from './persistence'

// A design's lifecycle in the editor: created, opened, closed, restored.
// When any of it reaches disk is persistence.ts's business, not this module's.

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Bring a design in from somewhere that is not a design file: a PDF, an SVG,
// or a file dropped on the window. The import is an intentional creation, so
// it becomes a library design right away — saving never touches the source,
// and the import survives even if the user closes the tab without editing.
// A plain new tab is not an import: it stays fileless until it has content
// (see materialize in persistence.ts).
export async function importDesign(json: unknown, name: string): Promise<DesignTab> {
  const tab = tabs.newTab({ json, name })
  await materialize(tab)
  return tab
}

// Open a design file from disk into a tab. Design files keep their path (the
// tab saves back to it); PDF/AI/SVG are imports — they become a new library
// design so saving never overwrites the source.
export async function openPath(filePath: string): Promise<void> {
  const existing = tabs.getByPath(filePath)
  if (existing) {
    tabs.activate(existing.docId)
    return
  }

  const kind = kindFromPath(filePath)
  try {
    switch (kind) {
      case 'project': {
        const { content } = await window.desktop.invoke('file:read', { filePath })
        tabs.newTab({ filePath, json: parseProjectText(content) })
        break
      }
      case 'pdf': {
        const { base64 } = await window.desktop.invoke('file:readBase64', { filePath })
        const json = await parsePdfBuffer(base64ToArrayBuffer(base64))
        await importDesign(json, nameFromPath(filePath))
        break
      }
      case 'svg': {
        const { content } = await window.desktop.invoke('file:read', { filePath })
        const json = await parseSvgText(content)
        await importDesign(json, nameFromPath(filePath))
        break
      }
      default:
        toast.error(`Cannot open this file type: ${nameFromPath(filePath)}`)
    }
  } catch (error) {
    console.error('Failed to open', filePath, error)
    toast.error(`Could not open ${nameFromPath(filePath)} — the file is not a valid design.`)
  }
}

export async function openViaDialog(): Promise<void> {
  const result = await window.desktop.invoke('file:openDialog')
  if (!result) return
  for (const filePath of result.filePaths) {
    await openPath(filePath)
  }
}

// Close a tab: keep whatever the user made, then close. No prompt — a design
// with content is already in the library, and deletion happens in My designs.
export async function requestCloseTab(docId: string): Promise<void> {
  const tab = tabs.get(docId)
  if (!tab) return
  if (isDirty(tab)) await save(docId)
  tabs.closeTab(docId)
  // The editor always shows a design; an empty tab strip gets a fresh one.
  // It stays fileless until the user draws in it, so closing the last tab
  // again and again leaves no trail of empty designs.
  if (tabs.tabs.length === 0) tabs.newTab()
}

let sessionRestored = false

// Reopen the files that were open when the app last closed; a fresh install
// (or empty session) starts with one blank design.
export async function restoreSession(): Promise<void> {
  // React StrictMode double-invokes effects; restore only once.
  if (sessionRestored) return
  sessionRestored = true
  const { filePaths } = await window.desktop.invoke('session:list')
  for (const filePath of filePaths) {
    await openPath(filePath)
  }
  if (tabs.tabs.length === 0) tabs.newTab()
}
