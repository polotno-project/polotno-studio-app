import { randomUUID } from 'node:crypto'
import type { DocId } from '../shared/types'

export interface DocumentEntry {
  docId: DocId
  // webContents id of the renderer hosting this document's live store.
  wcId: number
  filePath: string | null
  dirty: boolean
  // SHA-1 of the last content we wrote to disk; lets the file watcher tell
  // our own saves apart from external edits (stage 1 step 9).
  lastWrittenHash: string | null
}

class DocumentRegistry {
  private byId = new Map<DocId, DocumentEntry>()

  register(wcId: number, filePath: string | null): DocumentEntry {
    const entry: DocumentEntry = {
      docId: randomUUID(),
      wcId,
      filePath,
      dirty: false,
      lastWrittenHash: null
    }
    this.byId.set(entry.docId, entry)
    return entry
  }

  get(docId: DocId): DocumentEntry | undefined {
    return this.byId.get(docId)
  }

  getByPath(filePath: string): DocumentEntry | undefined {
    for (const entry of this.byId.values()) {
      if (entry.filePath === filePath) return entry
    }
    return undefined
  }

  setDirty(docId: DocId, dirty: boolean): void {
    const entry = this.byId.get(docId)
    if (entry) entry.dirty = dirty
  }

  setFilePath(docId: DocId, filePath: string): void {
    const entry = this.byId.get(docId)
    if (entry) entry.filePath = filePath
  }

  close(docId: DocId): void {
    this.byId.delete(docId)
  }

  all(): DocumentEntry[] {
    return [...this.byId.values()]
  }

  hasDirty(): boolean {
    return this.all().some((entry) => entry.dirty)
  }
}

export const documents = new DocumentRegistry()
