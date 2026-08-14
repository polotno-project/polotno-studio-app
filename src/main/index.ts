import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createEditorWindow } from './window'
import { installAppMenu } from './menu'
import { registerIpcHandlers } from './ipc'
import { collectOpenablePaths, requestOpenPath } from './open-files'
import { initBridgeRouter } from './bridge-router'
import { startMcpServer, stopMcpServer } from './mcp/launcher'
import { runCli } from './cli'
import { initUpdater } from './updater'

// Headless CLI subcommands (stage 3) branch before any window or lock exists,
// so the GUI path and the CLI path never fight.
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2)
const CLI_COMMANDS = new Set(['render', 'lint'])

if (CLI_COMMANDS.has(cliArgs[0])) {
  runCli(cliArgs)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // macOS delivers double-clicked files via open-file (possibly before ready).
  app.on('open-file', (event, filePath) => {
    event.preventDefault()
    requestOpenPath(filePath)
  })

  app.on('second-instance', (_event, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    for (const filePath of collectOpenablePaths(argv.slice(1))) {
      requestOpenPath(filePath)
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.polotno.app')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    registerIpcHandlers()
    initBridgeRouter()
    installAppMenu()
    createEditorWindow()
    startMcpServer()
    initUpdater()

    // Windows/Linux: files arrive as launch arguments.
    if (process.platform !== 'darwin') {
      for (const filePath of collectOpenablePaths(cliArgs)) {
        requestOpenPath(filePath)
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createEditorWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    stopMcpServer()
  })
}
