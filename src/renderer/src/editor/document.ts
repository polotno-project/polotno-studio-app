import { toast } from 'sonner'
import { tabs, nameFromPath, designSnapshot, type DesignTab } from './tabs-model'
import { kindFromPath, parseProjectText, parsePdfBuffer, parseSvgText } from './import-design'
import { isDirty, save } from './persistence'

// A design's lifecycle in the editor: created, opened, closed, restored.
// When any of it reaches disk is persistence.ts's business, not this module's.

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Create a design: the tab appears immediately and the design materializes as
// a real file in the library folder (Documents/Polotno) right away — every
// design has a file from birth, autosave keeps it fresh.
export async function createDesign(
  options: { json?: unknown; name?: string; activate?: boolean } = {}
): Promise<DesignTab> {
  const tab = tabs.newTab({
    json: options.json,
    name: options.name ?? 'Untitled',
    activate: options.activate ?? true
  })
  const { filePath } = await window.desktop.invoke('library:create', {
    name: tab.name,
    content: designSnapshot(tab.store)
  })
  tabs.setFilePath(tab.docId, filePath)
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
        await createDesign({ json, name: nameFromPath(filePath) })
        break
      }
      case 'svg': {
        const { content } = await window.desktop.invoke('file:read', { filePath })
        const json = await parseSvgText(content)
        await createDesign({ json, name: nameFromPath(filePath) })
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

// Close a tab: flush unsaved changes to its file, then close. No prompt —
// every design has a file, and deletion happens in My designs.
export async function requestCloseTab(docId: string): Promise<void> {
  const tab = tabs.get(docId)
  if (!tab) return
  if (tab.filePath && isDirty(tab)) await save(docId)
  tabs.closeTab(docId)
  // The editor always shows a design; an empty tab strip gets a fresh one.
  if (tabs.tabs.length === 0) await createDesign()
}

let sessionRestored = false

// Reopen the files that were open when the app last closed; a fresh install
// (or empty session) starts with one new library design.
export async function restoreSession(): Promise<void> {
  // React StrictMode double-invokes effects; restore only once.
  if (sessionRestored) return
  sessionRestored = true
  const { filePaths } = await window.desktop.invoke('session:list')
  for (const filePath of filePaths) {
    await openPath(filePath)
  }
  if (tabs.tabs.length === 0) await createDesign()
}
