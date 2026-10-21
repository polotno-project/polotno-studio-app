import type { BridgeRequest, BridgeResponse } from './bridge-protocol'
import type { DocId, RecentEntry } from './types'
import type {
  AgentEntry,
  AgentEvent,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentStatus,
  ChatSummary
} from './agent'

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

// Auto-update (src/main/updater.ts). `userAsked`: the person picked Check for
// Updates, so every step and the outcome are shown; a background check only
// surfaces an update once it is downloaded.
export type UpdateStatus = { userAsked: boolean } & (
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'upToDate'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }
)

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
  // Tab order after a drag in the tab strip; the session file follows it.
  'doc:reorder': (p: { docIds: DocId[] }) => void
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
  // Thumbnail of a library design that isn't open (drawn in the background).
  'library:writePreview': (p: { filePath: string; dataUrl: string }) => void
  // Files that were open when the app last closed.
  'session:list': () => { filePaths: string[] }
  'dialog:confirm': (p: { message: string; detail?: string; confirmLabel: string }) => boolean
  'dialog:externalChange': (p: { name: string }) => 'reload' | 'keep'
  'mcp:getStatus': () => McpStatus
  'mcp:regenerateToken': () => { token: string }
  'mcp:saveMcpb': () => { filePath: string } | null
  'mcp:installSkill': () => { path: string }
  'shell:openExternal': (p: { url: string }) => void
  'update:getStatus': () => UpdateStatus
  // Restarts into the downloaded update.
  'update:install': () => void
  // In-app generation through the user's own agent install (src/main/agents).
  // Every call goes to the agent the panel runs.
  'agent:list': () => { active: AgentId; agents: AgentInfo[] }
  // Switching ends the agent conversations; each chat goes on with the new
  // agent, which reads it first.
  'agent:setActive': (p: { agent: AgentId }) => void
  'agent:status': () => AgentStatus
  'agent:signIn': () => void
  'agent:models': () => AgentModels
  'agent:setModel': (p: { model: string | null }) => void
  // To the design's open chat (a new one if none is open); returns its id.
  'agent:run': (p: { docId: DocId; prompt: string }) => string
  // Stops one chat's run; the design's other chats keep going.
  'agent:stop': (p: { chatId: string }) => void
  // New chat: the open one stays in the design's list (and keeps running).
  'agent:reset': (p: { docId: DocId }) => void
  // A design's chats (kept with its file), the open chat's feed, and which
  // chats are working.
  'agent:chats': (p: { docId: DocId }) => {
    chats: ChatSummary[]
    activeId: string | null
    entries: AgentEntry[]
    running: string[]
  }
  // Opens another chat; the others keep running. A chat with no live agent
  // conversation starts one that reads it first. Returns the chat's feed.
  'agent:selectChat': (p: { docId: DocId; chatId: string }) => AgentEntry[]
  'agent:deleteChat': (p: { docId: DocId; chatId: string }) => void
  // A generated image at full size, by feed entry id.
  'agent:image': (p: { id: string }) => { dataUrl: string; width: number; height: number }
  // Canvas AI tools: edit an image (area to change painted magenta). They
  // need image generation, so they run on Codex whichever agent chats.
  'imageEdit:status': () => AgentStatus
  // Signs in to Codex without making it the chat agent.
  'imageEdit:signIn': () => void
  'imageEdit:run': (p: { id: string; png: Uint8Array; instruction: string }) => {
    dataUrl: string
  }
  'imageEdit:cancel': (p: { id: string }) => void
  // On-device background removal (src/main/remove-background.ts): Apple
  // Vision on macOS 14+, our ONNX models elsewhere and for "high quality".
  // `webgpu`: the renderer found a GPU adapter for high quality.
  'removeBackground:engines': (p: { webgpu: boolean }) => RemoveBackgroundEngines
  // Downloads a model on first use; progress comes as removeBackground:progress.
  'removeBackground:download': (p: { id: string; model: BackgroundModel }) => ModelDownloadResult
  // First use of high quality: what it costs, with "always use it" (native dialog).
  'removeBackground:confirmHq': (p: {
    message: string
    detail: string
    confirmLabel: string
    cancelLabel: string
    alwaysLabel: string
  }) => { confirmed: boolean; always: boolean }
  'removeBackground:setQuality': (p: { quality: RemoveBackgroundQuality }) => void
  'removeBackground:run': (p: {
    id: string
    image: Uint8Array
    engine: RemoveBackgroundEngine
  }) => RemoveBackgroundResult
  // Cancels a run or a download.
  'removeBackground:cancel': (p: { id: string }) => void
}

// vision: Apple Vision (macOS 14+). standard: IS-Net, where Vision isn't
// available. hq: BiRefNet, heavier and better, only when asked for.
export type RemoveBackgroundEngine = 'vision' | 'standard' | 'hq'
export type BackgroundModel = 'standard' | 'hq'
export type RemoveBackgroundQuality = 'standard' | 'high'
export type ModelDownloadResult = 'done' | 'canceled' | 'failed'

export interface RemoveBackgroundEngines {
  vision: boolean
  // hq is allowed on this machine (memory); the renderer also checks WebGPU.
  hq: boolean
  quality: RemoveBackgroundQuality
  installed: Record<BackgroundModel, boolean>
  // Download sizes in bytes.
  sizes: Record<BackgroundModel, number>
}

// noSubject: nothing to keep was found (a landscape, a texture).
// unreadable: the image format can't be decoded.
// gpuMemory: the GPU ran out of memory (high quality).
export type RemoveBackgroundResult =
  | { state: 'done'; dataUrl: string }
  | { state: 'canceled' }
  | { state: 'noSubject' }
  | { state: 'unreadable' }
  | { state: 'failed' }
  | { state: 'gpuMemory' }

export type MenuAction = 'newTab' | 'openFile' | 'save' | 'saveAs' | 'closeTab' | 'export'

// main -> renderer pushes (webContents.send).
export interface MainEvents {
  'menu:action': { action: MenuAction }
  'doc:externalChange': { docId: DocId }
  'doc:openPath': { filePath: string }
  // The window is closing: save everything, then answer with app:flushDone.
  'app:flushRequest': Record<string, never>
  'bridge:request': BridgeRequest
  'agent:event': AgentEvent
  // A design in the library folder (or its thumbnail) was added, changed,
  // renamed or removed.
  'library:changed': Record<string, never>
  // The MCP server started listening or went away (Connect panel stays live).
  'mcp:status': McpStatus
  // An export's download finished: saved (completed), cancelled in the save
  // dialog, or failed (interrupted).
  'export:downloadDone': { state: 'completed' | 'cancelled' | 'interrupted'; filePath: string }
  'update:status': UpdateStatus
  'removeBackground:progress': { id: string; received: number; total: number }
}

// Fire-and-forget renderer -> main messages (ipcRenderer.send).
export interface RendererEvents {
  'app:flushDone': Record<string, never>
  'bridge:response': BridgeResponse
}
