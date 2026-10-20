import { observable, runInAction } from 'mobx'
import type { LibraryEntry } from '../../../shared/ipc-contract'
import { parseProjectText } from './import-design'
import { PREVIEW_WIDTH } from './persistence'
import { createDesignStore, releaseDesignStore, type DesignStore } from './store'
import { tabs } from './tabs-model'

// Thumbnails for designs this app never had open (copied into the library
// folder, or saved before thumbnails existed): each is loaded into a hidden
// store, drawn off-screen (HiddenStages mounts `rendering`), captured like a
// saved design's thumbnail, then dropped. One at a time, in the background;
// a design that fails is not retried until the app restarts.

export const thumbnails = observable({ rendering: null as DesignStore | null })

const queue: string[] = []
const tried = new Set<string>()
let working = false

export function renderMissingThumbnails(entries: LibraryEntry[]): void {
  for (const entry of entries) {
    if (entry.preview || tried.has(entry.filePath)) continue
    // An open design gets its thumbnail when it saves.
    if (tabs.getByPath(entry.filePath)) continue
    tried.add(entry.filePath)
    queue.push(entry.filePath)
  }
  void work()
}

async function work(): Promise<void> {
  if (working) return
  working = true
  try {
    for (let filePath = queue.shift(); filePath; filePath = queue.shift()) {
      await render(filePath).catch((error) => console.warn('Thumbnail failed for', filePath, error))
    }
  } finally {
    working = false
  }
}

async function render(filePath: string): Promise<void> {
  const { content } = await window.desktop.invoke('file:read', { filePath })
  const store = createDesignStore()
  try {
    store.loadJSON(parseProjectText(content) as Parameters<DesignStore['loadJSON']>[0])
    runInAction(() => (thumbnails.rendering = store))
    // toDataURL waits for the page's stage to mount and its images and fonts.
    const dataUrl = await store.toDataURL({
      pixelRatio: PREVIEW_WIDTH / store.width,
      mimeType: 'image/jpeg',
      quality: 0.7
    })
    await window.desktop.invoke('library:writePreview', { filePath, dataUrl })
  } finally {
    runInAction(() => (thumbnails.rendering = null))
    releaseDesignStore(store)
  }
}
