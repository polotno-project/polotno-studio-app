import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log/main'

// Auto-update from GitHub Releases (differential downloads via blockmaps).
// Checks shortly after startup and every 4 hours; downloads in the background;
// installs on quit, or immediately when the user picks Restart.

const CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let updateReady = false

export function initUpdater(): void {
  if (!app.isPackaged) return

  // A packaged app has no visible console, so updater activity and errors go
  // to a file keyed to app.name: %APPDATA%\polotno-app\logs\main.log,
  // ~/Library/Logs/polotno-app/main.log, ~/.config/polotno-app/logs/main.log.
  log.transports.file.level = 'info'
  autoUpdater.logger = log

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true
    void dialog
      .showMessageBox({
        title: 'Polotno',
        type: 'info',
        message: `Polotno ${info.version} is ready`,
        detail: 'The update installs when you quit, or restart now.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
  })

  autoUpdater.on('error', (error) => {
    log.error('Updater error', error)
  })

  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), CHECK_DELAY_MS)
  setInterval(() => void autoUpdater.checkForUpdates().catch(() => undefined), CHECK_INTERVAL_MS)
}

// Menu item entry point: reports the outcome instead of failing silently.
export async function checkForUpdatesInteractive(): Promise<void> {
  if (!app.isPackaged) {
    dialog.showMessageBoxSync({
      title: 'Polotno',
      message: 'Updates are disabled in development builds.'
    })
    return
  }
  if (updateReady) {
    autoUpdater.quitAndInstall()
    return
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      dialog.showMessageBoxSync({
        title: 'Polotno',
        message: `You are up to date (Polotno ${app.getVersion()}).`
      })
    }
  } catch (error) {
    log.error('Interactive update check failed', error)
    dialog.showMessageBoxSync({
      title: 'Polotno',
      type: 'error',
      message: 'Could not check for updates.',
      detail: error instanceof Error ? error.message : String(error)
    })
  }
}
