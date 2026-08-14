import { createStore, type StoreType } from 'polotno/model/store'
import { POLOTNO_KEY } from './polotno-key'

export type DesignStore = StoreType

export function createDesignStore(): DesignStore {
  const store = createStore({ key: POLOTNO_KEY, showCredit: false })
  store.addPage()
  return store
}
