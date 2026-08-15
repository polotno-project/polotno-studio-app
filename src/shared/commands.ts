// The single vocabulary for store operations. Every agent-visible edit (MCP
// tools) and every internal bridge call maps to exactly one DesignCommand.
// The executor lives in the renderer (src/renderer/src/editor/executor.ts) and
// runs against the addressed tab's live store — so agent edits share the
// human's undo stack by construction.

export type DesignCommand =
  | { type: 'ping' }
  | { type: 'get_json' }
  | { type: 'get_info' }
  | { type: 'load_json'; json: unknown }
  | { type: 'set_size'; width: number; height: number; magicResize?: boolean }
  | { type: 'add_page'; background?: string; duration?: number }
  | { type: 'remove_page'; pageId: string }
  | { type: 'move_page'; pageId: string; toIndex: number }
  | { type: 'set_page'; pageId: string; props: Record<string, unknown> }
  | {
      type: 'add_element'
      pageId?: string
      element: Record<string, unknown>
      atIndex?: number
    }
  | { type: 'update_element'; elementId: string; props: Record<string, unknown> }
  | { type: 'remove_elements'; elementIds: string[] }
  | {
      type: 'move_element'
      elementId: string
      direction?: 'up' | 'down' | 'front' | 'back'
      toIndex?: number
    }
  | {
      type: 'render'
      pageId?: string
      pixelRatio?: number
      maxSide?: number
      mimeType?: 'image/png' | 'image/jpeg'
    }
  | { type: 'lint'; pageId?: string }
  | { type: 'export'; format: ExportFormat; pixelRatio?: number; pageId?: string }

// The file formats every caller can ask for — the editor's Export menu, the
// MCP tools, and the CLI all resolve `format` through this one union, so a
// name means the same thing whoever asked.
//
// 'pdf' is vector: text stays selectable and fonts are embedded, so an
// unloadable font fails the export. 'pdf-flat' rasterizes each page instead —
// it always succeeds and reproduces the canvas exactly, at the cost of
// selectable text. 'pixelRatio' applies to png, jpeg and pdf-flat; a vector
// PDF has no pixels to scale.
export type ExportFormat = 'png' | 'jpeg' | 'pdf' | 'pdf-flat'

// One file extension per format, so the MCP tools and the CLI cannot drift.
export const EXPORT_EXTENSIONS: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
  pdf: 'pdf',
  'pdf-flat': 'pdf'
}

// App-level commands target the editor window itself (docId: '') — tab
// management for agents.
export type AppCommand =
  | {
      type: 'create_tab'
      name?: string
      width?: number
      height?: number
      json?: unknown
      activate?: boolean
    }
  | { type: 'activate_tab'; docId: string }
  | { type: 'open_path'; filePath: string }
  | { type: 'list_tabs' }
  | { type: 'save_tab'; docId: string; filePath?: string }

export type BridgeCommand = DesignCommand | AppCommand

// Commands that change the document (drive the per-design rev counter).
export const MUTATING_COMMANDS: ReadonlySet<DesignCommand['type']> = new Set([
  'load_json',
  'set_size',
  'add_page',
  'remove_page',
  'move_page',
  'set_page',
  'add_element',
  'update_element',
  'remove_elements',
  'move_element'
] as DesignCommand['type'][])

export interface CommandFailure {
  code:
    | 'document_not_found'
    | 'page_not_found'
    | 'element_not_found'
    | 'invalid_command'
    | 'invalid_json'
    | 'timeout'
    | 'internal'
  message: string
}

export type CommandResult =
  | { ok: true; value?: unknown; rev?: number }
  | { ok: false; error: CommandFailure }
