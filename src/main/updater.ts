import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import logger from 'electron-log/main'
import type { UpdateStatus } from '../shared/ipc-contract'
import { createEditorWindow } from './window'

// Auto-update from GitHub Releases (differential downloads via blockmaps).
// Checks shortly after startup and every 4 hours; downloads in the background;
// installs on quit, or immediately when the user picks Restart. Main owns the
// status; the renderer shows it as a toast (src/renderer/src/editor/updates.ts).

const CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

// A packaged app has no visible console: without a file, a failed check or an
// interrupted download leaves no trace. ~/Library/Logs/polotno-app/updater.log
// on macOS, %APPDATA%\polotno-app\logs on Windows, ~/.config/polotno-app/logs on Linux.
const log = logger.create({ logId: 'updater' })
log.transports.file.fileName = 'updater.log'

let status: UpdateStatus = { state: 'idle', userAsked: false }

function setStatus(next: UpdateStatus): void {
  status = next
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('update:status', status)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

// electron-updater errors can carry a whole HTTP response; the toast gets the
// first line, the log keeps everything.
function shortMessage(error: Error): string {
  const line = error.message.split('\n')[0].trim()
  return line.length > 160 ? `${line.slice(0, 157)}…` : line
}

function check(): void {
  // A check now would download the same update again.
  if (status.state === 'downloading' || status.state === 'ready') return
  void autoUpdater.checkForUpdates().catch(() => undefined) // reported by the 'error' event
}

export function initUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking', userAsked: status.userAsked })
  })
  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'upToDate', version: app.getVersion(), userAsked: status.userAsked })
  })
  autoUpdater.on('update-available', (info) => {
    setStatus({
      state: 'downloading',
      version: info.version,
      percent: 0,
      userAsked: status.userAsked
    })
  })
  autoUpdater.on('download-progress', (progress) => {
    // Fires many times a second; the toast only shows whole percents.
    const percent = Math.floor(progress.percent)
    if (status.state !== 'downloading' || status.percent === percent) return
    setStatus({ ...status, percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ state: 'ready', version: info.version, userAsked: status.userAsked })
  })
  autoUpdater.on('error', (error) => {
    // Already downloaded: a later hiccup must not hide the Restart offer.
    if (status.state === 'ready') return
    setStatus({ state: 'error', message: shortMessage(error), userAsked: status.userAsked })
  })

  const backgroundCheck = (): void => {
    if (status.state !== 'downloading' && status.state !== 'ready') {
      status = { ...status, userAsked: false }
    }
    check()
  }
  setTimeout(backgroundCheck, CHECK_DELAY_MS)
  setInterval(backgroundCheck, CHECK_INTERVAL_MS)
}

// Menu item entry point: from here on the renderer shows every step, including
// a download already running in the background and an update already waiting.
export function checkForUpdatesInteractive(): void {
  if (!app.isPackaged) {
    dialog.showMessageBoxSync({
      title: 'Polotno',
      message: 'Updates are disabled in development builds.'
    })
    return
  }
  // Focuses the window, or opens one (macOS keeps running without): the toast
  // needs it.
  createEditorWindow()
  if (status.state === 'downloading' || status.state === 'ready') {
    setStatus({ ...status, userAsked: true })
    return
  }
  // Straight to checking, so the previous outcome doesn't flash first.
  setStatus({ state: 'checking', userAsked: true })
  check()
}

export function installUpdate(): void {
  if (status.state === 'ready') autoUpdater.quitAndInstall()
}
