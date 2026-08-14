import type { CommandResult } from '../../../shared/commands'
import { tabs } from './tabs-model'
import { executeCommand, CommandError } from './executor'

// Executes bridge requests from main against the addressed tab's live store.
// Works for background tabs too — the store does not need a mounted editor.
window.desktop.on('bridge:request', ({ id, docId, command }) => {
  void (async () => {
    let result: CommandResult
    const tab = tabs.get(docId)
    if (!tab) {
      result = {
        ok: false,
        error: { code: 'document_not_found', message: `No open tab for ${docId}` }
      }
    } else {
      try {
        result = { ok: true, value: await executeCommand(tab.store, command) }
      } catch (error) {
        result = {
          ok: false,
          error:
            error instanceof CommandError
              ? { code: error.code, message: error.message }
              : { code: 'internal', message: String(error) }
        }
      }
    }
    window.desktop.send('bridge:response', { id, result })
  })()
})
