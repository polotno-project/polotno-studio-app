import type { DocId } from './types'

// The in-app Codex integration as the renderer sees it. Main owns the
// `codex app-server` process and translates its protocol into these shapes.

export type CodexStatus =
  | { state: 'missing' }
  | { state: 'starting' }
  | { state: 'signedOut' }
  | { state: 'signingIn' }
  | { state: 'ready'; email: string | null; plan: string | null; version: string | null }
  | { state: 'error'; message: string }

// One row in the panel's activity feed for a design's conversation.
export type CodexEntry =
  | { kind: 'prompt'; id: string; text: string }
  | { kind: 'message'; id: string; text: string; done: boolean }
  | {
      kind: 'tool'
      id: string
      tool: string
      status: 'running' | 'done' | 'failed'
      error?: string
    }
  | {
      kind: 'image'
      id: string
      status: 'running' | 'done' | 'failed'
      // Small preview data URL once the image exists.
      preview?: string
      prompt?: string
    }
  | { kind: 'error'; id: string; text: string }

export type CodexTurnState = 'idle' | 'running'

export type CodexEvent =
  | { type: 'status'; status: CodexStatus }
  | { type: 'entry'; docId: DocId; entry: CodexEntry }
  | { type: 'turn'; docId: DocId; state: CodexTurnState }
