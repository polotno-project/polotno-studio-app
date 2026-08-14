import type { BridgeRequest, BridgeResponse } from './bridge-protocol'
import type { DocId, RecentEntry } from './types'

// Single source of truth for every IPC channel. The preload derives the typed
// window.desktop API from these interfaces; main registers handlers against
// them. Add a channel here first, then implement both sides.

export interface OpenedFile {
  filePath: string
  content: string
}

// Promise-based renderer -> main calls (ipcRenderer.invoke).
export interface InvokeApi {
  'doc:register': (p: { filePath: string | null }) => { docId: DocId }
  'doc:setFilePath': (p: { docId: DocId; filePath: string }) => void
  'doc:setDirty': (p: { docId: DocId; dirty: boolean }) => void
  'doc:close': (p: { docId: DocId }) => void
  'file:openDialog': () => OpenedFile[] | null
  'file:read': (p: { filePath: string }) => OpenedFile
  'file:write': (p: { docId?: DocId; filePath: string; content: string }) => void
  'file:saveAsDialog': (p: { suggestedName: string }) => { filePath: string } | null
  'recent:list': () => RecentEntry[]
}

export type MenuAction =
  | 'newTab'
  | 'openFile'
  | 'save'
  | 'saveAs'
  | 'closeTab'
  | 'export'
  | 'devBridgeTest'

// main -> renderer pushes (webContents.send).
export interface MainEvents {
  'menu:action': { action: MenuAction }
  'doc:externalChange': { docId: DocId }
  'doc:openPath': OpenedFile
  'bridge:request': BridgeRequest
}

// Fire-and-forget renderer -> main messages (ipcRenderer.send).
export interface RendererEvents {
  'bridge:response': BridgeResponse
}
