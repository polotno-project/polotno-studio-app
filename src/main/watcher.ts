import { watch, type FSWatcher } from 'chokidar'
import { promises as fs } from 'node:fs'
import { webContents } from 'electron'
import type { DocId } from '../shared/types'
import { documents } from './documents'
import { contentHash } from './files'

// One watcher per open file-backed document. Our own saves are recognized by
// content hash (files.ts records it on every write) and ignored; anything else
// is a real external change and the renderer decides what to do with it.
const watchers = new Map<DocId, FSWatcher>()

export function watchDocument(docId: DocId): void {
  unwatchDocument(docId)
  const entry = documents.get(docId)
  if (!entry?.filePath) return
  const { filePath } = entry
  const watcher = watch(filePath, { ignoreInitial: true })
  watcher.on('change', () => {
    void (async () => {
      const current = documents.get(docId)
      if (!current || current.filePath !== filePath) return
      let hash: string
      try {
        hash = contentHash(await fs.readFile(filePath, 'utf8'))
      } catch {
        return // transient read failure (mid-write); the next event retries
      }
      if (hash === current.lastWrittenHash) return
      webContents.fromId(current.wcId)?.send('doc:externalChange', { docId })
    })()
  })
  watchers.set(docId, watcher)
}

export function unwatchDocument(docId: DocId): void {
  const watcher = watchers.get(docId)
  if (watcher) {
    void watcher.close()
    watchers.delete(docId)
  }
}
