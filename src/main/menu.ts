import { app, dialog, Menu, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { MenuAction } from '../shared/ipc-contract'
import { documents } from './documents'
import { execCommand } from './bridge-router'
import { checkForUpdatesInteractive } from './updater'

function sendMenuAction(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', { action })
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const checkForUpdatesItem: Electron.MenuItemConstructorOptions = {
    label: 'Check for Updates…',
    click: () => void checkForUpdatesInteractive()
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              checkForUpdatesItem,
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Design',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('newTab')
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('openFile')
        },
        ...(isMac
          ? [
              {
                role: 'recentDocuments' as const,
                submenu: [{ role: 'clearRecentDocuments' as const }]
              }
            ]
          : []),
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('save')
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => sendMenuAction('saveAs')
        },
        {
          label: 'Export…',
          accelerator: 'CmdOrCtrl+E',
          click: () => sendMenuAction('export')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuAction('closeTab')
        },
        ...(isMac ? [] : [{ role: 'quit' as const }])
      ]
    },
    // No Undo/Redo menu items on purpose: the Polotno workspace and native
    // text inputs both handle Cmd/Ctrl+Z themselves; a menu accelerator would
    // swallow the keystroke before the page sees it.
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    ...(isMac ? [] : [{ label: 'Help', submenu: [checkForUpdatesItem] }]),
    ...(is.dev
      ? [
          {
            label: 'Dev',
            submenu: [
              {
                label: 'Bridge Round-Trip Test',
                click: async (): Promise<void> => {
                  const entry = documents.all()[0]
                  if (!entry) return
                  const pong = await execCommand(entry.docId, { type: 'ping' })
                  const json = await execCommand(entry.docId, { type: 'get_json' })
                  const pages =
                    json.ok && json.value ? (json.value as { pages: unknown[] }).pages.length : '?'
                  dialog.showMessageBoxSync({
                    message: 'Bridge round-trip',
                    detail: `ping -> ${JSON.stringify(pong)}\nget_json -> ${pages} page(s)`
                  })
                }
              }
            ]
          }
        ]
      : [])
  ]

  // No app.setName here: renaming would also move userData (it is keyed to
  // package.json "name" = polotno-app, which the mcpb proxy relies on).
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
