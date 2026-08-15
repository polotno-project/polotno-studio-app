import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { RecentEntry } from '../shared/types'
import { keepExisting } from './files'

// Own list (powers Open Recent on all platforms and a future welcome screen)
// plus the native integration (macOS Open Recent menu role, Windows jump list)
// via app.addRecentDocument.
const MAX_RECENT = 20

function recentPath(): string {
  return join(app.getPath('userData'), 'recent.json')
}

export async function listRecent(): Promise<RecentEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(recentPath(), 'utf8'))
    if (!Array.isArray(parsed)) return []
    // Never offer a design that is no longer there — picking it could only fail.
    const alive = new Set(await keepExisting(parsed.map((entry) => entry.filePath)))
    return parsed.filter((entry) => alive.has(entry.filePath))
  } catch {
    return []
  }
}

export async function addRecent(filePath: string): Promise<void> {
  app.addRecentDocument(filePath)
  const entries = (await listRecent()).filter((entry) => entry.filePath !== filePath)
  entries.unshift({
    filePath,
    name: basename(filePath).replace(/\.(polotno|json)$/i, ''),
    openedAt: Date.now()
  })
  await fs.writeFile(recentPath(), JSON.stringify(entries.slice(0, MAX_RECENT)), 'utf8')
}
