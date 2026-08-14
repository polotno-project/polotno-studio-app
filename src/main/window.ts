import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let editorWindow: BrowserWindow | null = null

export function getEditorWindow(): BrowserWindow | null {
  return editorWindow
}

export function createEditorWindow(): BrowserWindow {
  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus()
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

  editorWindow.on('ready-to-show', () => editorWindow?.show())
  editorWindow.on('closed', () => {
    editorWindow = null
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
