import type { BridgeCommand, CommandResult } from './commands'
import type { DocId } from './types'

// Request/response envelope between main's bridge router and any renderer that
// hosts live stores. Main never interprets commands — it correlates by id and
// routes by docId. Stage 2 reuses this envelope verbatim for the MCP process.

// docId '' addresses the editor window itself (AppCommand).
export interface BridgeRequest {
  id: string
  docId: DocId
  command: BridgeCommand
}

export interface BridgeResponse {
  id: string
  result: CommandResult
}
