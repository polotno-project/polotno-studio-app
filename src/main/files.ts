import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, basename } from 'node:path'
import { dialog, BrowserWindow } from 'electron'
import type { OpenedFile } from '../shared/ipc-contract'
import { documents } from './documents'
import type { DocId } from '../shared/types'

const DESIGN_FILE_FILTERS = [
  { name: 'Polotno Design', extensions: ['polotno', 'json'] },
  { name: 'All Files', extensions: ['*'] }
]

export function contentHash(content: string): string {
  return createHash('sha1').update(content).digest('hex')
}

export async function readDesignFile(filePath: string): Promise<OpenedFile> {
  const content = await fs.readFile(filePath, 'utf8')
  return { filePath, content }
}

// Atomic write: temp file in the same directory, then rename. Records the
// content hash on the owning document so the watcher can ignore our own saves.
export async function writeDesignFile(
  filePath: string,
  content: string,
  docId?: DocId
): Promise<void> {
  const tmpPath = join(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`)
  if (docId) {
    const entry = documents.get(docId)
    if (entry) entry.lastWrittenHash = contentHash(content)
  }
  try {
    await fs.writeFile(tmpPath, content, 'utf8')
    await fs.rename(tmpPath, filePath)
  } catch (error) {
    await fs.rm(tmpPath, { force: true })
    throw error
  }
}

export async function showOpenDesignDialog(win: BrowserWindow): Promise<OpenedFile[] | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: DESIGN_FILE_FILTERS
  })
  if (canceled || filePaths.length === 0) return null
  return Promise.all(filePaths.map(readDesignFile))
}

export async function showSaveAsDialog(
  win: BrowserWindow,
  suggestedName: string
): Promise<{ filePath: string } | null> {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName.endsWith('.polotno') ? suggestedName : `${suggestedName}.polotno`,
    filters: DESIGN_FILE_FILTERS
  })
  if (canceled || !filePath) return null
  return { filePath }
}
