import { useCallback, useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import {
  SectionTab,
  TemplatesSection as StockTemplatesSection,
  type Section
} from 'polotno/side-panel'
import { LayoutTemplate, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from 'polotno/primitives/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from 'polotno/primitives/dropdown-menu'
import { Input } from 'polotno/primitives/input'
import type { LibraryEntry } from '../../../../shared/ipc-contract'
import type { DesignStore } from '../store'
import { tabs } from '../tabs-model'
import { openPath } from '../document'
import { SegmentedTabs } from './segmented-tabs'

const DesignCard = observer(function DesignCard({
  entry,
  onChanged
}: {
  entry: LibraryEntry
  onChanged: () => void
}): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(entry.name)
  const openTab = tabs.getByPath(entry.filePath)
  const isActive = openTab?.docId === tabs.activeDocId

  const finishRename = async (): Promise<void> => {
    setRenaming(false)
    const name = draftName.trim()
    if (!name || name === entry.name) return
    try {
      const { filePath } = await window.desktop.invoke('library:rename', {
        filePath: entry.filePath,
        name
      })
      if (openTab) tabs.setFilePath(openTab.docId, filePath)
      onChanged()
    } catch (error) {
      console.error('Rename failed', error)
      toast.error('Could not rename the design.')
    }
  }

  const duplicate = async (): Promise<void> => {
    await window.desktop.invoke('library:duplicate', { filePath: entry.filePath })
    onChanged()
  }

  const remove = async (): Promise<void> => {
    const confirmed = await window.desktop.invoke('dialog:confirm', {
      message: `Move "${entry.name}" to the trash?`,
      detail: 'You can restore it from the system trash.',
      confirmLabel: 'Move to Trash'
    })
    if (!confirmed) return
    // Close first so autosave cannot resurrect the file after deletion.
    if (openTab) tabs.closeTab(openTab.docId)
    await window.desktop.invoke('library:delete', { filePath: entry.filePath })
    if (tabs.tabs.length === 0) tabs.newTab()
    onChanged()
  }

  return (
    <div
      className={
        'group relative flex flex-col overflow-hidden rounded-md border text-left transition-colors ' +
        (isActive
          ? 'border-blue-500'
          : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500')
      }
    >
      <button
        onClick={() => void openPath(entry.filePath)}
        className="flex aspect-square w-full items-center justify-center bg-neutral-50 dark:bg-neutral-900"
      >
        {entry.preview ? (
          <img src={entry.preview} alt={entry.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <LayoutTemplate className="size-6 text-neutral-300" />
        )}
      </button>
      <div className="flex items-center gap-1 px-2 py-1.5">
        {renaming ? (
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void finishRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void finishRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="h-6 flex-1 px-1 text-xs"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {entry.name}
            {openTab && <span className="ml-1 text-[10px] text-blue-500">open</span>}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button className="shrink-0 rounded-sm p-0.5 opacity-0 group-hover:opacity-70 hover:bg-neutral-200 hover:!opacity-100 dark:hover:bg-neutral-700">
                <MoreHorizontal className="size-3.5" />
              </button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                setDraftName(entry.name)
                setRenaming(true)
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void duplicate()}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
})

const MyDesignsPanel = observer(function MyDesignsPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const refresh = useCallback(() => {
    void window.desktop.invoke('library:list').then(setEntries)
  }, [])
  useEffect(refresh, [refresh])

  return (
    <div className="flex h-full flex-col gap-2">
      {/* The new design is a blank tab, not a library file yet — it joins the
          list below as soon as the user puts something in it. */}
      <Button size="sm" onClick={() => tabs.newTab()}>
        <Plus className="size-3.5" />
        New design
      </Button>
      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pb-2">
        {entries.map((entry) => (
          <DesignCard key={entry.filePath} entry={entry} onChanged={refresh} />
        ))}
        {entries.length === 0 && (
          <p className="col-span-2 pt-6 text-center text-xs text-neutral-400">
            Designs you create are saved here (Documents/Polotno).
          </p>
        )}
      </div>
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
