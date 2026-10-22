import { app, ipcMain, dialog, shell, BrowserWindow, Menu } from 'electron'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
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
  writePreview,
  libraryDir
} from './library'
import { persistSession, loadSession } from './session-store'
import { listRecent, addRecent } from './recent'
import { markRendererReady } from './open-files'
import { getMcpStatus, restartMcpServer } from './mcp/launcher'
import { regenerateMcpToken } from './mcp/token'
import { getUpdateStatus, installUpdate } from './updater'
import {
  agentImage,
  closeAgentConversations,
  deleteChat,
  getAgentModels,
  getChats,
  moveAgentChats,
  newChat,
  selectChat,
  getAgentStatus,
  listAgents,
  resetAllAgents,
  runAgent,
  setActiveAgent,
  setAgentModel,
  signInToAgent,
  stopAgent
} from './agents'
import {
  cancelImageEdit,
  editImageWithCodex,
  getCodexStatus,
  signInToCodex
} from './agents/codex/provider'
import { deleteChatsOf, renameChatsOf } from './agents/chats'
import {
  cancelRemoveBackground,
  downloadBackgroundModel,
  removeBackground,
  removeBackgroundEngines,
  setRemoveBackgroundQuality
} from './remove-background'
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
    void moveAgentChats(docId, filePath)
    watchDocument(docId)
    void addRecent(filePath)
    persistSession()
  })
  handle('doc:close', (_event, { docId }) => {
    // An agent run on a closed design would keep spending usage on edits that
    // can no longer land.
    void closeAgentConversations(docId)
    unwatchDocument(docId)
    documents.close(docId)
    persistSession()
  })
  // A reload (View > Reload) replaces a window's tabs with new ones: the old
  // ones close the same way, without a doc:close. The saved session is left
  // alone; the reloaded window restores its tabs from it.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (!isMainFrame || isSameDocument) return
      for (const { docId, wcId } of documents.all()) {
        if (wcId !== contents.id) continue
        void closeAgentConversations(docId)
        unwatchDocument(docId)
        documents.close(docId)
      }
    })
  })
  handle('doc:reorder', (_event, { docIds }) => {
    documents.reorder(docIds)
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
  handle('library:rename', async (_event, { filePath, name }) => {
    const renamed = await renameLibraryDesign(filePath, name)
    await renameChatsOf(filePath, renamed)
    return { filePath: renamed }
  })
  handle('library:duplicate', async (_event, { filePath }) => ({
    filePath: await duplicateLibraryDesign(filePath)
  }))
  handle('library:delete', async (_event, { filePath }) => {
    await deleteLibraryDesign(filePath)
    await deleteChatsOf(filePath)
  })
  handle('design:writePreview', (_event, { docId, dataUrl }) => {
    const entry = documents.get(docId)
    if (entry?.filePath) void writePreview(entry.filePath, dataUrl)
  })
  handle('library:writePreview', async (_event, { filePath, dataUrl }) => {
    // Only for files in the library folder, which the list came from.
    if (dirname(filePath) !== libraryDir()) throw new Error('Not a library design.')
    await writePreview(filePath, dataUrl)
  })
  handle('session:list', async () => ({ filePaths: await loadSession() }))

  handle('dialog:confirm', async (event, { message, detail, confirmLabel }) => {
    const { response } = await dialog.showMessageBox(windowOf(event), {
      title: 'Polotno',
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
      title: 'Polotno',
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
  handle('app:showMenu', (event, { x, y }) => {
    Menu.getApplicationMenu()?.popup({ window: windowOf(event), x, y })
  })

  handle('mcp:getStatus', () => getMcpStatus())
  handle('mcp:regenerateToken', () => {
    const token = regenerateMcpToken()
    restartMcpServer()
    resetAllAgents()
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
  handle('update:getStatus', () => getUpdateStatus())
  handle('update:install', () => installUpdate())
  handle('agent:list', () => listAgents())
  handle('agent:setActive', (_event, { agent }) => setActiveAgent(agent))
  handle('agent:status', () => getAgentStatus())
  handle('agent:signIn', () => signInToAgent())
  handle('agent:models', () => getAgentModels())
  handle('agent:setModel', (_event, { model }) => setAgentModel(model))
  handle('agent:run', (_event, { docId, prompt }) => runAgent(docId, prompt))
  handle('agent:stop', (_event, { chatId }) => stopAgent(chatId))
  handle('agent:reset', (_event, { docId }) => newChat(docId))
  handle('agent:chats', (_event, { docId }) => getChats(docId))
  handle('agent:selectChat', (_event, { docId, chatId }) => selectChat(docId, chatId))
  handle('agent:deleteChat', (_event, { docId, chatId }) => deleteChat(docId, chatId))
  handle('agent:image', (_event, { id }) => agentImage(id))
  handle('imageEdit:status', () => getCodexStatus())
  handle('imageEdit:signIn', () => signInToCodex())
  handle('imageEdit:run', (_event, { id, png, instruction }) =>
    editImageWithCodex(id, png, instruction)
  )
  handle('imageEdit:cancel', (_event, { id }) => cancelImageEdit(id))
  handle('removeBackground:engines', (_event, { webgpu }) => removeBackgroundEngines(webgpu))
  handle('removeBackground:download', (event, { id, model }) =>
    downloadBackgroundModel(id, model, (received, total) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('removeBackground:progress', { id, received, total })
      }
    })
  )
  handle('removeBackground:confirmHq', async (event, labels) => {
    const { response, checkboxChecked } = await dialog.showMessageBox(windowOf(event), {
      title: 'Polotno',
      type: 'question',
      message: labels.message,
      detail: labels.detail,
      buttons: [labels.confirmLabel, labels.cancelLabel],
      checkboxLabel: labels.alwaysLabel,
      defaultId: 0,
      cancelId: 1
    })
    return { confirmed: response === 0, always: response === 0 && checkboxChecked }
  })
  handle('removeBackground:setQuality', (_event, { quality }) =>
    setRemoveBackgroundQuality(quality)
  )
  handle('removeBackground:run', (_event, { id, image, engine }) =>
    removeBackground(id, image, engine)
  )
  handle('removeBackground:cancel', (_event, { id }) => cancelRemoveBackground(id))
}
