import type { DesignCommand } from '../../../shared/commands'
import type { DesignStore } from './store'

export class CommandError extends Error {
  constructor(
    public code: 'invalid_command' | 'invalid_json' | 'element_not_found',
    message: string
  ) {
    super(message)
  }
}

// The ONE implementation of the DesignCommand vocabulary, executed against a
// live store (visible tab today; hidden store-host in stage 2). Grows one case
// per MCP tool.
export async function executeCommand(store: DesignStore, command: DesignCommand): Promise<unknown> {
  switch (command.type) {
    case 'ping':
      return 'pong'
    case 'get_json':
      return store.toJSON()
    case 'load_json': {
      try {
        store.loadJSON(command.json)
      } catch (error) {
        throw new CommandError('invalid_json', String(error))
      }
      await store.waitLoading()
      return null
    }
    default:
      throw new CommandError(
        'invalid_command',
        `Unknown command: ${(command as { type: string }).type}`
      )
  }
}
