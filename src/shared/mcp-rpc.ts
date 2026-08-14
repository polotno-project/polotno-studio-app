import type { AppCommand, CommandResult, DesignCommand } from './commands'

// Message protocol between main and the MCP utilityProcess (over parentPort).

export type RpcRequestMap = {
  'design.exec': { params: { docId: string; command: DesignCommand }; result: CommandResult }
  'app.exec': { params: { command: AppCommand }; result: CommandResult }
  'designs.list': {
    params: Record<string, never>
    result: {
      open: unknown
      recent: { filePath: string; name: string; openedAt: number }[]
    }
  }
  'export.write': {
    params: { fileName: string; base64: string; dir?: string }
    result: { path: string }
  }
}

export type RpcMethod = keyof RpcRequestMap

export type ChildToMain =
  | { type: 'listening'; url: string }
  | { type: 'rpc'; id: string; method: RpcMethod; params: unknown }

export type MainToChild = {
  type: 'rpc-result'
  id: string
  ok: boolean
  result?: unknown
  error?: string
}
