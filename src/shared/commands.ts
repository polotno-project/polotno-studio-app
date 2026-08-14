// The single vocabulary for store mutations. Every agent-visible edit (stage 2
// MCP tools) and every internal bridge call maps to exactly one DesignCommand.
// The executor lives in the renderer (src/renderer/src/editor/executor.ts) and
// is registered on every live store, visible or hidden.

export type DesignCommand =
  | { type: 'ping' }
  | { type: 'get_json' }
  | { type: 'load_json'; json: unknown }

export interface CommandFailure {
  code:
    | 'document_not_found'
    | 'element_not_found'
    | 'invalid_command'
    | 'invalid_json'
    | 'timeout'
    | 'internal'
  message: string
}

export type CommandResult =
  | { ok: true; value?: unknown }
  | { ok: false; error: CommandFailure }
