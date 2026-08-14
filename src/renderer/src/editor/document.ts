import { toast } from 'sonner'
import { tabs, nameFromPath, type DesignTab } from './tabs-model'
import { kindFromPath, parseProjectText, parsePdfBuffer, parseSvgText } from './import-design'

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

// Open a design file from disk into a tab. Project files keep their path (a
// tab saves back to it); PDF/AI/SVG are imports — the tab starts untitled so
// saving never overwrites the source with Polotno JSON.
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
        tabs.newTab({ json, name: nameFromPath(filePath) })
        break
      }
      case 'svg': {
        const { content } = await window.desktop.invoke('file:read', { filePath })
        const json = await parseSvgText(content)
        tabs.newTab({ json, name: nameFromPath(filePath) })
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

export function serializeTab(tab: DesignTab): string {
  return JSON.stringify(tab.store.toJSON())
}

export async function saveTab(docId: string): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  if (!tab.filePath) return saveTabAs(docId)
  await window.desktop.invoke('file:write', {
    docId: tab.docId,
    filePath: tab.filePath,
    content: serializeTab(tab)
  })
  tabs.setDirty(tab.docId, false)
  return true
}

export async function saveTabAs(docId: string): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  const result = await window.desktop.invoke('file:saveAsDialog', { suggestedName: tab.name })
  if (!result) return false
  tabs.setFilePath(tab.docId, result.filePath)
  await window.desktop.invoke('file:write', {
    docId: tab.docId,
    filePath: result.filePath,
    content: serializeTab(tab)
  })
  tabs.setDirty(tab.docId, false)
  return true
}
