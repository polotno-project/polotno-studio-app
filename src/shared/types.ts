export type DocId = string

export interface RecentEntry {
  filePath: string
  name: string
  openedAt: number
}

export interface DesignMeta {
  docId: DocId
  filePath: string | null
  name: string
  dirty: boolean
}
