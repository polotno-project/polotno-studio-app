import { ipcMain, dialog, BrowserWindow } from 'electron'
import type { InvokeApi } from '../shared/ipc-contract'
import { documents } from './documents'
import { listDrafts, writeDraft, removeDraft } from './drafts'
import {
  readDesignFile,
  readDesignFileBase64,
  writeDesignFile,
  showOpenDesignDialog,
  showSaveAsDialog
} from './files'

type Handler<C extends keyof InvokeApi> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: Parameters<InvokeApi[C]>
) => ReturnType<InvokeApi[C]> | Promise<ReturnType<InvokeApi[C]>>

// Single typed registration point: channels only exist if they are declared
// in InvokeApi (src/shared/ipc-contract.ts).
function handle<C extends keyof InvokeApi>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler as never)
}

function windowOf(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('IPC call from a webContents without a window')
  return win
}

export function registerIpcHandlers(): void {
  handle('doc:register', (event, { docId, filePath }) => {
    documents.register(docId, event.sender.id, filePath)
  })
  handle('doc:setFilePath', (_event, { docId, filePath }) => documents.setFilePath(docId, filePath))
  handle('doc:setDirty', (_event, { docId, dirty }) => documents.setDirty(docId, dirty))
  handle('doc:close', (_event, { docId }) => documents.close(docId))

  handle('file:openDialog', (event) => showOpenDesignDialog(windowOf(event)))
  handle('file:read', (_event, { filePath }) => readDesignFile(filePath))
  handle('file:readBase64', (_event, { filePath }) => readDesignFileBase64(filePath))
  handle('file:write', (_event, { docId, filePath, content }) =>
    writeDesignFile(filePath, content, docId)
  )
  handle('file:saveAsDialog', (event, { suggestedName }) =>
    showSaveAsDialog(windowOf(event), suggestedName)
  )

  handle('draft:list', () => listDrafts())
  handle('draft:write', (_event, { docId, content }) => writeDraft(docId, content))
  handle('draft:remove', (_event, { docId }) => removeDraft(docId))

  handle('dialog:confirmCloseUntitled', async (event, { name }) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'warning',
      message: `Save "${name}" before closing?`,
      detail: 'The design has not been saved to a file yet.',
      buttons: ['Save…', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2
    })
    return (['save', 'discard', 'cancel'] as const)[response]
  })

  // Populated by the recent-files step (stage 1 step 10).
  handle('recent:list', () => [])
}
