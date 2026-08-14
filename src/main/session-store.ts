import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { documents } from './documents'

// Remembers which files are open so the next launch restores them.
function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

let writeQueue: Promise<void> = Promise.resolve()

export function persistSession(): void {
  const filePaths = documents
    .all()
    .map((entry) => entry.filePath)
    .filter((filePath): filePath is string => Boolean(filePath))
  writeQueue = writeQueue.then(() =>
    fs
      .writeFile(sessionPath(), JSON.stringify({ filePaths }))
      .catch((error) => console.error('Failed to persist session', error))
  )
}

export async function loadSession(): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(sessionPath(), 'utf8'))
    return Array.isArray(parsed.filePaths) ? parsed.filePaths : []
  } catch {
    return []
  }
}
