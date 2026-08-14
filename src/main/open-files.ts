import type { BrowserWindow } from 'electron'
import { createEditorWindow, getEditorWindow } from './window'

// OS entry points (macOS open-file, launch argv, second-instance argv) can fire
// before the renderer has mounted and registered its doc:openPath listener.
// Paths queue here and flush once the renderer says it is ready.

const pending: string[] = []
let rendererReady = false

const OPENABLE = /\.(polotno|json|pdf|ai|svg)$/i

export function isOpenableFile(path: string): boolean {
  return OPENABLE.test(path)
}

export function collectOpenablePaths(argv: string[]): string[] {
  // Skip electron/app binary, the app path in dev, and --flags.
  return argv.filter((arg) => !arg.startsWith('-') && isOpenableFile(arg))
}

function deliver(win: BrowserWindow, filePath: string): void {
  win.webContents.send('doc:openPath', { filePath })
}

export function requestOpenPath(filePath: string): void {
  const win = getEditorWindow() ?? createEditorWindow()
  if (rendererReady && !win.webContents.isLoading()) {
    deliver(win, filePath)
  } else {
    pending.push(filePath)
  }
}

export function markRendererReady(): void {
  rendererReady = true
  const win = getEditorWindow()
  if (!win) return
  while (pending.length > 0) {
    deliver(win, pending.shift()!)
  }
}
