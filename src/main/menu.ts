import { app, Menu, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import type { MenuAction } from '../shared/ipc-contract'

function sendMenuAction(action: MenuAction): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', { action })
}

export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
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
    ...(is.dev
      ? [
          {
            label: 'Dev',
            submenu: [
              {
                label: 'Bridge Round-Trip Test',
                click: (): void => sendMenuAction('devBridgeTest')
              }
            ]
          }
        ]
      : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  app.setName('Polotno')
}
