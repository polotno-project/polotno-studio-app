import type { AppCommand } from '../../../shared/commands'
import { tabs } from './tabs-model'
import { openPath, saveTab, createDesign } from './document'
import { CommandError } from './executor'

// Tab-level operations for agents (bridge requests with docId '').
export async function executeAppCommand(command: AppCommand): Promise<unknown> {
  switch (command.type) {
    case 'create_tab': {
      const tab = await createDesign({
        json: command.json,
        name: command.name,
        activate: command.activate ?? false
      })
      if (!command.json && command.width && command.height) {
        tab.store.setSize(command.width, command.height)
      }
      await tab.store.waitLoading()
      return { designId: tab.docId, filePath: tab.filePath }
    }

    case 'activate_tab': {
      if (!tabs.get(command.docId)) {
        throw new CommandError('invalid_command', `No open tab ${command.docId}`)
      }
      tabs.activate(command.docId)
      return null
    }

    case 'open_path': {
      await openPath(command.filePath)
      const tab = tabs.getByPath(command.filePath)
      if (!tab) throw new CommandError('invalid_json', `Could not open ${command.filePath}`)
      return { designId: tab.docId }
    }

    case 'list_tabs':
      return tabs.tabs.map((tab) => ({
        designId: tab.docId,
        name: tab.name,
        filePath: tab.filePath,
        dirty: tab.dirty,
        active: tab.docId === tabs.activeDocId,
        pageCount: tab.store.pages.length,
        width: tab.store.width,
        height: tab.store.height
      }))

    case 'save_tab': {
      const tab = tabs.get(command.docId)
      if (!tab) throw new CommandError('invalid_command', `No open tab ${command.docId}`)
      if (command.filePath) tabs.setFilePath(command.docId, command.filePath)
      await saveTab(command.docId)
      return { filePath: tab.filePath }
    }

    default:
      throw new CommandError(
        'invalid_command',
        `Unknown app command: ${(command as { type: string }).type}`
      )
  }
}
