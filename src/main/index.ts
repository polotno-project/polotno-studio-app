import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createEditorWindow } from './window'
import { installAppMenu } from './menu'
import { registerIpcHandlers } from './ipc'

// Headless CLI subcommands (stage 3) branch before any window or lock exists,
// so the GUI path and the CLI path never fight.
const cliArgs = process.argv.slice(app.isPackaged ? 1 : 2)
const CLI_COMMANDS = new Set(['render', 'export', 'lint'])

if (CLI_COMMANDS.has(cliArgs[0])) {
  console.error(`polotno ${cliArgs[0]}: the headless CLI is not implemented yet`)
  app.exit(2)
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.polotno.app')
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    registerIpcHandlers()
    installAppMenu()
    createEditorWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createEditorWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
