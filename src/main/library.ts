import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { LibraryEntry } from '../shared/ipc-contract'
import { writeDesignFile } from './files'

// The design library: a visible folder (~/Documents/Polotno) that "My designs"
// lists and every design materializes into once it has content. Thumbnails are
// sidecar JPEGs in userData/previews, keyed by a hash of the file path.

export function libraryDir(): string {
  return join(app.getPath('documents'), 'Polotno')
}

async function ensureLibraryDir(): Promise<string> {
  const dir = libraryDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function previewsDir(): string {
  return join(app.getPath('userData'), 'previews')
}

function previewPath(filePath: string): string {
  const key = createHash('sha1').update(filePath).digest('hex')
  return join(previewsDir(), `${key}.jpg`)
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const dir = await ensureLibraryDir()
  const names = await fs.readdir(dir)
  const entries: LibraryEntry[] = []
  for (const fileName of names) {
    if (!/\.(json|polotno)$/.test(fileName)) continue
    const filePath = join(dir, fileName)
    try {
      const stat = await fs.stat(filePath)
      let preview: string | null = null
      try {
        const jpg = await fs.readFile(previewPath(filePath))
        preview = `data:image/jpeg;base64,${jpg.toString('base64')}`
      } catch {
        // no thumbnail yet
      }
      entries.push({
        filePath,
        name: fileName.replace(/\.(polotno|json)$/, ''),
        modifiedAt: stat.mtimeMs,
        preview
      })
    } catch {
      // unreadable entry — skip
    }
  }
  return entries.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

async function uniqueLibraryPath(name: string): Promise<string> {
  const dir = await ensureLibraryDir()
  const safe = name.replace(/[/\\:]/g, '-').trim() || 'Untitled'
  for (let i = 0; ; i++) {
    const candidate = join(dir, i === 0 ? `${safe}.json` : `${safe} ${i + 1}.json`)
    try {
      await fs.access(candidate)
    } catch {
      return candidate
    }
  }
}

export async function createLibraryDesign(name: string, content: string): Promise<string> {
  const filePath = await uniqueLibraryPath(name)
  await writeDesignFile(filePath, content)
  return filePath
}

export async function renameLibraryDesign(filePath: string, newName: string): Promise<string> {
  const newPath = await uniqueLibraryPath(newName)
  await fs.rename(filePath, newPath)
  await fs.rename(previewPath(filePath), previewPath(newPath)).catch(() => undefined)
  return newPath
}

export async function duplicateLibraryDesign(filePath: string): Promise<string> {
  const name = basename(filePath).replace(/\.(polotno|json)$/, '')
  const newPath = await uniqueLibraryPath(`${name} copy`)
  await fs.copyFile(filePath, newPath)
  await fs.copyFile(previewPath(filePath), previewPath(newPath)).catch(() => undefined)
  return newPath
}

export async function deleteLibraryDesign(filePath: string): Promise<void> {
  await shell.trashItem(filePath)
  await fs.rm(previewPath(filePath), { force: true })
}

export async function writePreview(filePath: string, dataUrl: string): Promise<void> {
  await fs.mkdir(previewsDir(), { recursive: true })
  const base64 = dataUrl.split(',')[1]
  if (!base64) return
  await fs.writeFile(previewPath(filePath), Buffer.from(base64, 'base64'))
}

// One-time migration: hidden drafts from the pre-library model become real
// library files.
export async function migrateDraftsToLibrary(): Promise<void> {
  const draftsDir = join(app.getPath('userData'), 'drafts')
  let names: string[]
  try {
    names = await fs.readdir(draftsDir)
  } catch {
    return
  }
  for (const fileName of names) {
    if (!/\.(json|polotno)$/.test(fileName)) continue
    try {
      const content = await fs.readFile(join(draftsDir, fileName), 'utf8')
      await createLibraryDesign('Untitled', content)
      await fs.rm(join(draftsDir, fileName), { force: true })
    } catch (error) {
      console.error('Draft migration failed for', fileName, error)
    }
  }
}
