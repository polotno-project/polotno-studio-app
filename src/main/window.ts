import { BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

let editorWindow: BrowserWindow | null = null

// Windows draws its min/max/close buttons over the tab strip. A transparent
// overlay lets the strip's own background show through; only the glyphs need
// to follow the OS theme (the renderer follows it via prefers-color-scheme).
function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  return {
    height: 40,
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#e5e5e5' : '#404040'
  }
}

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
    // The tab strip doubles as the title bar: no system chrome, only the
    // native window controls (macOS traffic lights / Windows overlay).
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay() }
      : {}),
    // Linux keeps the system title bar; the menu bar under it is replaced by
    // the tab strip's menu button (Alt still reveals it).
    ...(process.platform === 'linux' ? { icon, autoHideMenuBar: true } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  // POLOTNO_SHOW_INACTIVE: automated test runs show the window without
  // activating the app, so launches don't steal the user's focus.
  // hidden: the headless CLI never shows the window at all.
  let revealed = false
  const reveal = (): void => {
    if (options.hidden || revealed) return
    revealed = true
    if (process.env.POLOTNO_SHOW_INACTIVE) editorWindow?.showInactive()
    else editorWindow?.show()
  }
  editorWindow.once('ready-to-show', reveal)
  // Electron 38+ on Wayland often never emits ready-to-show for a hidden
  // window (electron/electron#48859), which left the app running with no
  // window on Ubuntu 24.04. Fall back to showing once the page has loaded.
  if (process.platform === 'linux') editorWindow.webContents.once('did-finish-load', reveal)
  if (process.platform === 'win32') {
    const win = editorWindow
    const syncOverlay = (): void => win.setTitleBarOverlay(titleBarOverlay())
    nativeTheme.on('updated', syncOverlay)
    win.on('closed', () => nativeTheme.removeListener('updated', syncOverlay))
  }
  editorWindow.on('closed', () => {
    editorWindow = null
  })

  // Autosave-by-flush instead of a quit prompt: before the window closes, the
  // renderer saves every tab to its file. The timeout keeps a hung renderer
  // from blocking quit.
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
