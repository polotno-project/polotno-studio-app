import type { CommandResult, DesignCommand, AppCommand } from '../../../shared/commands'
import { tabs } from './tabs-model'
import { executeCommand, CommandError } from './executor'
import { executeAppCommand } from './app-executor'

// Executes bridge requests from main. docId '' addresses the window itself
// (tab management); any other docId addresses that tab's live store — mounted
// or not, background tabs work the same.
window.desktop.on('bridge:request', ({ id, docId, command }) => {
  void (async () => {
    let result: CommandResult
    try {
      if (docId === '') {
        result = { ok: true, value: await executeAppCommand(command as AppCommand) }
      } else {
        const tab = tabs.get(docId)
        if (!tab) {
          result = {
            ok: false,
            error: { code: 'document_not_found', message: `No open tab for ${docId}` }
          }
        } else {
          result = { ok: true, value: await executeCommand(tab.store, command as DesignCommand) }
        }
      }
    } catch (error) {
      result = {
        ok: false,
        error:
          error instanceof CommandError
            ? { code: error.code, message: error.message }
            : { code: 'internal', message: String(error) }
      }
    }
    window.desktop.send('bridge:response', { id, result })
  })()
})
