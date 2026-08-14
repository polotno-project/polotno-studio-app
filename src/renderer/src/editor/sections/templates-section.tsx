import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import {
  SectionTab,
  TemplatesSection as StockTemplatesSection,
  type Section
} from 'polotno/side-panel'
import { LayoutTemplate, FileClock } from 'lucide-react'
import type { DesignStore } from '../store'
import { tabs, type DesignTab } from '../tabs-model'
import { openPath } from '../document'
import { SegmentedTabs } from './segmented-tabs'

// One card per open tab, thumbnail rendered from its live store.
const OpenDesignCard = observer(function OpenDesignCard({
  tab
}: {
  tab: DesignTab
}): React.JSX.Element {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void tab.store
      .toDataURL({ pixelRatio: 200 / tab.store.width, mimeType: 'image/jpeg', quality: 0.7 })
      .then((url: string) => {
        if (!cancelled) setPreview(url)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tab])
  const isActive = tab.docId === tabs.activeDocId
  return (
    <button
      onClick={() => tabs.activate(tab.docId)}
      className={
        'flex flex-col gap-1 overflow-hidden rounded-md border text-left transition-colors ' +
        (isActive
          ? 'border-blue-500'
          : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500')
      }
    >
      <div className="flex aspect-square w-full items-center justify-center bg-neutral-50 dark:bg-neutral-900">
        {preview ? (
          <img src={preview} alt={tab.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <LayoutTemplate className="size-6 text-neutral-300" />
        )}
      </div>
      <span className="truncate px-2 pb-1.5 text-xs font-medium">{tab.name}</span>
    </button>
  )
})

const MyDesignsPanel = observer(function MyDesignsPanel(): React.JSX.Element {
  const [recent, setRecent] = useState<{ filePath: string; name: string }[]>([])
  useEffect(() => {
    void window.desktop.invoke('recent:list').then(setRecent)
  }, [])
  const openPaths = new Set(tabs.tabs.map((tab) => tab.filePath).filter(Boolean))
  const closedRecent = recent.filter((entry) => !openPaths.has(entry.filePath))
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto">
      <div>
        <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase">Open</p>
        <div className="grid grid-cols-2 gap-2">
          {tabs.tabs.map((tab) => (
            <OpenDesignCard key={tab.docId} tab={tab} />
          ))}
        </div>
      </div>
      {closedRecent.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold text-neutral-500 uppercase">Recent files</p>
          <div className="flex flex-col">
            {closedRecent.map((entry) => (
              <button
                key={entry.filePath}
                onClick={() => void openPath(entry.filePath)}
                title={entry.filePath}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                <FileClock className="size-4 shrink-0 text-neutral-400" />
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
})

const StockPanel = StockTemplatesSection.Panel as React.ComponentType<{ store: DesignStore }>

const Panel = observer(function Panel({ store }: { store: DesignStore }): React.JSX.Element {
  const [tab, setTab] = useState<'stock' | 'mine'>('stock')
  return (
    <div className="flex h-full flex-col">
      <SegmentedTabs
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: 'stock', label: 'Library' },
          { value: 'mine', label: 'My designs' }
        ]}
      />
      <div className="min-h-0 flex-1">
        {tab === 'mine' ? <MyDesignsPanel /> : <StockPanel store={store} />}
      </div>
    </div>
  )
})

// Replaces polotno's default `templates` section: same slot name, custom Tab,
// and a Panel that tabs between the Polotno template library and the user's
// designs (mirrors the new studio's MyTemplatesSection).
export const TemplatesSection: Section = {
  name: 'templates',
  Tab: ((props: { onClick: () => void; active: boolean }) => (
    <SectionTab name="Templates" {...props}>
      {/* Tailwind preflight sets svg { display: block }, defeating SectionTab's
          centering; mx-auto size-6 matches polotno's stock tab icons. */}
      <LayoutTemplate className="mx-auto size-6" />
    </SectionTab>
  )) as unknown as Section['Tab'],
  Panel: Panel as unknown as Section['Panel']
}
