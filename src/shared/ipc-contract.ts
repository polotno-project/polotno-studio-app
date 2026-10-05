import type { BridgeRequest, BridgeResponse } from './bridge-protocol'
import type { DocId, RecentEntry } from './types'
import type { CodexEvent, CodexStatus } from './codex'

// Single source of truth for every IPC channel. The preload derives the typed
// window.desktop API from these interfaces; main registers handlers against
// them. Add a channel here first, then implement both sides.

export interface OpenedFile {
  filePath: string
  content: string
}

export interface LibraryEntry {
  filePath: string
  name: string
  modifiedAt: number
  // Small JPEG data URL, or null when no thumbnail exists yet.
  preview: string | null
}

export interface McpStatus {
  running: boolean
  url: string | null
  token: string
}

// Promise-based renderer -> main calls (ipcRenderer.invoke).
export interface InvokeApi {
  'doc:register': (p: { docId: DocId; filePath: string | null }) => void
  'doc:setFilePath': (p: { docId: DocId; filePath: string }) => void
  'doc:close': (p: { docId: DocId }) => void
  'file:openDialog': () => { filePaths: string[] } | null
  'file:read': (p: { filePath: string }) => OpenedFile
  'file:readBase64': (p: { filePath: string }) => { filePath: string; base64: string }
  'file:write': (p: { docId?: DocId; filePath: string; content: string }) => void
  'file:saveAsDialog': (p: { suggestedName: string }) => { filePath: string } | null
  'recent:list': () => RecentEntry[]
  // Renderer announces its doc:openPath listener is live; main flushes queued opens.
  'app:rendererReady': () => void
  // Pops up the application menu at a window point (no menu bar on Windows/Linux).
  'app:showMenu': (p: { x: number; y: number }) => void
  'library:list': () => LibraryEntry[]
  'library:create': (p: { name: string; content: string }) => { filePath: string }
  'library:rename': (p: { filePath: string; name: string }) => { filePath: string }
  'library:duplicate': (p: { filePath: string }) => { filePath: string }
  'library:delete': (p: { filePath: string }) => void
  // Thumbnail sidecar for the doc's file (shown in My designs).
  'design:writePreview': (p: { docId: DocId; dataUrl: string }) => void
  // Files that were open when the app last closed.
  'session:list': () => { filePaths: string[] }
  'dialog:confirm': (p: { message: string; detail?: string; confirmLabel: string }) => boolean
  'dialog:externalChange': (p: { name: string }) => 'reload' | 'keep'
  'mcp:getStatus': () => McpStatus
  'mcp:regenerateToken': () => { token: string }
  'mcp:saveMcpb': () => { filePath: string } | null
  'mcp:installSkill': () => { path: string }
  'shell:openExternal': (p: { url: string }) => void
  // In-app generation through the user's Codex install (src/main/codex).
  'codex:status': () => CodexStatus
  'codex:signIn': () => void
  'codex:run': (p: { docId: DocId; prompt: string }) => void
  'codex:stop': (p: { docId: DocId }) => void
  'codex:reset': (p: { docId: DocId }) => void
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
  'codex:event': CodexEvent
  // The MCP server started listening or went away (Connect panel stays live).
  'mcp:status': McpStatus
}

// Fire-and-forget renderer -> main messages (ipcRenderer.send).
export interface RendererEvents {
  'app:flushDone': Record<string, never>
  'bridge:response': BridgeResponse
}
