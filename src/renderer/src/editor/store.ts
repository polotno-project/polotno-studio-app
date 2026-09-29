import { reaction } from 'mobx'
import { createStore, type StoreType } from 'polotno/model/store'
import { POLOTNO_KEY } from './polotno-key'

export type DesignStore = StoreType

// Every open design keeps a mounted Konva stage (the visible editor or a
// hidden one), and Polotno's export finds a page's stage by page id across the
// whole document, taking the first match. Two open designs sharing a page id
// (a duplicated file, the same template used twice) would export each other's
// canvas, so page ids are kept unique across open designs.
const liveStores = new Map<DesignStore, () => void>()

function takenPageIds(except: DesignStore): Set<string> {
  const ids = new Set<string>()
  for (const other of liveStores.keys()) {
    if (other !== except) for (const page of other.pages) ids.add(page.id)
  }
  return ids
}

// A page id is a mobx-state-tree identifier and cannot be changed in place, so
// the design is reloaded with fresh ids for the colliding pages.
function renameCollidingPages(store: DesignStore): void {
  const taken = takenPageIds(store)
  if (!store.pages.some((page) => taken.has(page.id))) return
  const json = store.toJSON()
  const activeIndex = store.activePage ? store.pages.indexOf(store.activePage) : -1
  const pages = (json.pages as { id: string }[]).map((page) =>
    taken.has(page.id) ? { ...page, id: crypto.randomUUID() } : page
  )
  // Folded into the current undo state: undo must not bring the old id back.
  void store.history.ignore(() => {
    store.loadJSON({ ...json, pages }, { keepHistory: true })
    if (activeIndex >= 0) store.selectPage(pages[activeIndex].id)
  })
}

export function createDesignStore(): DesignStore {
  const store = createStore({ key: POLOTNO_KEY, showCredit: false })
  store.addPage()
  // fireImmediately: created inside an action (tabs.newTab), the reaction's
  // first run waits for the action to end — after the design is loaded — and
  // without it would take the loaded ids as its baseline and never check them.
  const dispose = reaction(
    () => store.pages.map((page) => page.id),
    () => renameCollidingPages(store),
    { fireImmediately: true }
  )
  liveStores.set(store, dispose)
  return store
}

export function releaseDesignStore(store: DesignStore): void {
  liveStores.get(store)?.()
  liveStores.delete(store)
}
