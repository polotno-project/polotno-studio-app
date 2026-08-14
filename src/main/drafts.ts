import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { DocId } from '../shared/types'
import { writeDesignFile } from './files'

// Untitled designs autosave here so nothing is ever lost. A draft is removed
// when its tab gets a real file (Save As) or is closed deliberately.
function draftsDir(): string {
  return join(app.getPath('userData'), 'drafts')
}

function draftPath(docId: DocId): string {
  return join(draftsDir(), `${docId}.polotno`)
}

export async function listDrafts(): Promise<{ docId: string; content: string }[]> {
  let names: string[]
  try {
    names = await fs.readdir(draftsDir())
  } catch {
    return []
  }
  const drafts: { docId: string; content: string }[] = []
  for (const name of names) {
    if (!name.endsWith('.polotno')) continue
    try {
      const content = await fs.readFile(join(draftsDir(), name), 'utf8')
      drafts.push({ docId: name.replace(/\.polotno$/, ''), content })
    } catch (error) {
      console.error('Failed to read draft', name, error)
    }
  }
  return drafts
}

export async function writeDraft(docId: DocId, content: string): Promise<void> {
  await fs.mkdir(draftsDir(), { recursive: true })
  await writeDesignFile(draftPath(docId), content)
}

export async function removeDraft(docId: DocId): Promise<void> {
  await fs.rm(draftPath(docId), { force: true })
}
