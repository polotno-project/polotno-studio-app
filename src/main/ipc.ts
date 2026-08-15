import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { InvokeApi } from '../shared/ipc-contract'
import { documents } from './documents'
import { watchDocument, unwatchDocument } from './watcher'
import {
  listLibrary,
  createLibraryDesign,
  renameLibraryDesign,
  duplicateLibraryDesign,
  deleteLibraryDesign,
  writePreview
} from './library'
import { persistSession, loadSession } from './session-store'
import { listRecent, addRecent } from './recent'
import { markRendererReady } from './open-files'
import { getMcpStatus, restartMcpServer } from './mcp/launcher'
import { regenerateMcpToken } from './mcp/token'
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
    if (filePath) {
      watchDocument(docId)
      void addRecent(filePath)
    }
    persistSession()
  })
  handle('doc:setFilePath', (_event, { docId, filePath }) => {
    documents.setFilePath(docId, filePath)
    watchDocument(docId)
    void addRecent(filePath)
    persistSession()
  })
  handle('doc:close', (_event, { docId }) => {
    unwatchDocument(docId)
    documents.close(docId)
    persistSession()
  })

  handle('file:openDialog', (event) => showOpenDesignDialog(windowOf(event)))
  handle('file:read', (_event, { filePath }) => readDesignFile(filePath))
  handle('file:readBase64', (_event, { filePath }) => readDesignFileBase64(filePath))
  handle('file:write', (_event, { docId, filePath, content }) =>
    writeDesignFile(filePath, content, docId)
  )
  handle('file:saveAsDialog', (event, { suggestedName }) =>
    showSaveAsDialog(windowOf(event), suggestedName)
  )

  handle('library:list', () => listLibrary())
  handle('library:create', async (_event, { name, content }) => ({
    filePath: await createLibraryDesign(name, content)
  }))
  handle('library:rename', async (_event, { filePath, name }) => ({
    filePath: await renameLibraryDesign(filePath, name)
  }))
  handle('library:duplicate', async (_event, { filePath }) => ({
    filePath: await duplicateLibraryDesign(filePath)
  }))
  handle('library:delete', (_event, { filePath }) => deleteLibraryDesign(filePath))
  handle('design:writePreview', (_event, { docId, dataUrl }) => {
    const entry = documents.get(docId)
    if (entry?.filePath) void writePreview(entry.filePath, dataUrl)
  })
  handle('session:list', async () => ({ filePaths: await loadSession() }))

  handle('dialog:confirm', async (event, { message, detail, confirmLabel }) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'warning',
      message,
      detail,
      buttons: [confirmLabel, 'Cancel'],
      defaultId: 1,
      cancelId: 1
    })
    return response === 0
  })

  handle('dialog:externalChange', async (event, { name }) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      type: 'question',
      message: `"${name}" changed on disk`,
      detail: 'The file was modified outside this app while you have unsaved changes.',
      buttons: ['Reload From Disk', 'Keep My Changes'],
      defaultId: 0,
      cancelId: 1
    })
    return response === 0 ? 'reload' : 'keep'
  })

  handle('recent:list', () => listRecent())
  handle('app:rendererReady', () => markRendererReady())

  handle('mcp:getStatus', () => getMcpStatus())
  handle('mcp:regenerateToken', () => {
    const token = regenerateMcpToken()
    restartMcpServer()
    return { token }
  })
  handle('mcp:saveMcpb', async (event) => {
    const source = is.dev
      ? join(app.getAppPath(), 'out/Polotno.mcpb')
      : join(process.resourcesPath, 'Polotno.mcpb')
    const { canceled, filePath } = await dialog.showSaveDialog(windowOf(event), {
      defaultPath: 'Polotno.mcpb',
      filters: [{ name: 'MCP Bundle', extensions: ['mcpb'] }]
    })
    if (canceled || !filePath) return null
    await fs.copyFile(source, filePath)
    return { filePath }
  })
  handle('mcp:installSkill', async () => {
    const source = is.dev
      ? join(app.getAppPath(), 'vendor/skills/polotno-design')
      : join(process.resourcesPath, 'skills/polotno-design')
    const target = join(app.getPath('home'), '.claude/skills/polotno-design')
    await fs.rm(target, { recursive: true, force: true })
    await fs.mkdir(target, { recursive: true })
    await fs.cp(source, target, { recursive: true })
    return { path: target }
  })
  handle('shell:openExternal', (_event, { url }) => {
    if (!/^(https?|cursor|vscode):/.test(url)) throw new Error(`Refusing to open ${url}`)
    void shell.openExternal(url)
  })
}
