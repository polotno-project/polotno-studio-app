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
  'doc:register': (p: { docId: DocId; filePath: string | null }) => void
  'doc:setFilePath': (p: { docId: DocId; filePath: string }) => void
  'doc:setDirty': (p: { docId: DocId; dirty: boolean }) => void
  'doc:close': (p: { docId: DocId }) => void
  'file:openDialog': () => { filePaths: string[] } | null
  'file:read': (p: { filePath: string }) => OpenedFile
  'file:readBase64': (p: { filePath: string }) => { filePath: string; base64: string }
  'file:write': (p: { docId?: DocId; filePath: string; content: string }) => void
  'file:saveAsDialog': (p: { suggestedName: string }) => { filePath: string } | null
  'recent:list': () => RecentEntry[]
  // Renderer announces its doc:openPath listener is live; main flushes queued opens.
  'app:rendererReady': () => void
  'draft:list': () => { docId: string; content: string }[]
  'draft:write': (p: { docId: DocId; content: string }) => void
  'draft:remove': (p: { docId: DocId }) => void
  'dialog:confirmCloseUntitled': (p: { name: string }) => 'save' | 'discard' | 'cancel'
  'dialog:externalChange': (p: { name: string }) => 'reload' | 'keep'
  'mcp:getStatus': () => { running: boolean; url: string | null; token: string }
  'mcp:regenerateToken': () => { token: string }
  'mcp:saveMcpb': () => { filePath: string } | null
  'shell:openExternal': (p: { url: string }) => void
}

export type MenuAction = 'newTab' | 'openFile' | 'save' | 'saveAs' | 'closeTab' | 'export'

// main -> renderer pushes (webContents.send).
export interface MainEvents {
  'menu:action': { action: MenuAction }
  'doc:externalChange': { docId: DocId }
  'doc:openPath': { filePath: string }
  // The window is closing: save everything, then answer with app:flushDone.
  'app:flushRequest': Record<string, never>
  'bridge:request': BridgeRequest
}

// Fire-and-forget renderer -> main messages (ipcRenderer.send).
export interface RendererEvents {
  'app:flushDone': Record<string, never>
  'bridge:response': BridgeResponse
}
