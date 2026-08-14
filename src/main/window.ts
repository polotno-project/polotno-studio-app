import { BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let editorWindow: BrowserWindow | null = null

export function getEditorWindow(): BrowserWindow | null {
  return editorWindow
}

export function createEditorWindow(options: { hidden?: boolean } = {}): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    if (!options.hidden) editorWindow.focus()
    return editorWindow
  }

  editorWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  // POLOTNO_SHOW_INACTIVE: automated test runs show the window without
  // activating the app, so launches don't steal the user's focus.
  // hidden: the headless CLI never shows the window at all.
  editorWindow.on('ready-to-show', () => {
    if (options.hidden) return
    if (process.env.POLOTNO_SHOW_INACTIVE) editorWindow?.showInactive()
    else editorWindow?.show()
  })
  editorWindow.on('closed', () => {
    editorWindow = null
  })

  // Autosave-by-flush instead of a quit prompt: before the window closes, the
  // renderer saves every file-backed tab and drafts every untitled one. The
  // timeout keeps a hung renderer from blocking quit.
  let flushed = false
  editorWindow.on('close', (event) => {
    if (flushed || !editorWindow) return
    event.preventDefault()
    const win = editorWindow
    const done = (): void => {
      if (flushed) return
      flushed = true
      clearTimeout(timer)
      ipcMain.removeListener('app:flushDone', done)
      win.close()
    }
    const timer = setTimeout(done, 3000)
    ipcMain.once('app:flushDone', done)
    win.webContents.send('app:flushRequest', {})
  })

  editorWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // file:// in production is load-bearing: the Polotno SDK reports origin
  // "electron" for file:// pages, which is the domain registered for the key.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    editorWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    editorWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return editorWindow
}
