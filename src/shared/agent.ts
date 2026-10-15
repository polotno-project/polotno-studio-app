import type { DocId } from './types'

// The in-app AI agents as the renderer sees them. Main owns each agent's
// process (the user's own Codex or Claude Code) and translates its protocol
// into these shapes, so the panel works the same whichever agent runs.

export type AgentId = 'codex' | 'claude'

export type AgentInfo = { id: AgentId; name: string }

export type AgentStatus =
  | { state: 'missing' }
  | { state: 'starting' }
  | { state: 'signedOut' }
  | { state: 'signingIn' }
  | { state: 'ready'; email: string | null; plan: string | null; version: string | null }
  | { state: 'error'; message: string }

// One row in the panel's activity feed for a design's conversation.
export type AgentEntry =
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

// A model the user's account can run, for the panel's model picker.
export type AgentModelInfo = { id: string; name: string; description: string; isDefault: boolean }

// `selected` is the user's pick; null means "whatever the agent runs by
// default" (for Codex: their config.toml model when the account can use it).
export type AgentModels = { models: AgentModelInfo[]; selected: string | null }

export type AgentTurnState = 'idle' | 'running'

export type AgentEvent =
  | { type: 'status'; agent: AgentId; status: AgentStatus }
  | { type: 'entry'; docId: DocId; entry: AgentEntry }
  | { type: 'turn'; docId: DocId; state: AgentTurnState }
