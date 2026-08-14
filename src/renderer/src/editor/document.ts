import { toast } from 'sonner'
import { tabs, nameFromPath, designSnapshot, type DesignTab } from './tabs-model'
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
  return designSnapshot(tab.store)
}

export async function saveTab(docId: string): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  if (!tab.filePath) return saveTabAs(docId)
  const content = serializeTab(tab)
  await window.desktop.invoke('file:write', {
    docId: tab.docId,
    filePath: tab.filePath,
    content
  })
  tab.baseline = content
  tabs.setDirty(tab.docId, false)
  return true
}

export async function saveTabAs(docId: string): Promise<boolean> {
  const tab = tabs.get(docId)
  if (!tab) return false
  const result = await window.desktop.invoke('file:saveAsDialog', { suggestedName: tab.name })
  if (!result) return false
  tabs.setFilePath(tab.docId, result.filePath)
  const content = serializeTab(tab)
  await window.desktop.invoke('file:write', {
    docId: tab.docId,
    filePath: result.filePath,
    content
  })
  tab.baseline = content
  tabs.setDirty(tab.docId, false)
  if (tab.hasDraft) {
    await window.desktop.invoke('draft:remove', { docId: tab.docId })
    tab.hasDraft = false
  }
  return true
}

// Close a tab safely. File-backed tabs flush silently (consistent with
// autosave-to-file); untitled tabs with content prompt Save / Don't Save /
// Cancel through a native dialog.
export async function requestCloseTab(docId: string): Promise<void> {
  const tab = tabs.get(docId)
  if (!tab) return
  const dirty = serializeTab(tab) !== tab.baseline || tab.dirty

  if (tab.filePath) {
    if (dirty) await saveTab(docId)
    tabs.closeTab(docId)
    return
  }

  if (dirty || tab.hasDraft) {
    const choice = await window.desktop.invoke('dialog:confirmCloseUntitled', { name: tab.name })
    if (choice === 'cancel') return
    if (choice === 'save') {
      const saved = await saveTabAs(docId)
      if (!saved) return
    }
  }
  if (tab.hasDraft) {
    await window.desktop.invoke('draft:remove', { docId: tab.docId })
  }
  tabs.closeTab(docId)
}
