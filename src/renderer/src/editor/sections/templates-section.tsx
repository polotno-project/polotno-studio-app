import { useCallback, useEffect, useState } from 'react'
import { observable, runInAction } from 'mobx'
import { observer } from 'mobx-react-lite'
import {
  SectionTab,
  TemplatesSection as StockTemplatesSection,
  type Section
} from 'polotno/side-panel'
import { Check, LayoutTemplate, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
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

// Which half of the panel shows (Library or My designs). The editor remounts
// per tab, so this lives outside the panel: switching or opening tabs keeps it.
const view = observable({ tab: 'stock' as 'stock' | 'mine' })

// Closes the designs' tabs first (so autosave can't bring the files back),
// then moves them to the trash.
async function deleteDesigns(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    const openTab = tabs.getByPath(filePath)
    if (openTab) tabs.closeTab(openTab.docId)
    await window.desktop.invoke('library:delete', { filePath })
  }
  if (tabs.tabs.length === 0) tabs.newTab()
}

const DesignCard = observer(function DesignCard({
  entry,
  onChanged,
  selected,
  selecting,
  onToggle
}: {
  entry: LibraryEntry
  onChanged: () => void
  selected: boolean
  // Some designs are selected: a click selects instead of opening.
  selecting: boolean
  onToggle: () => void
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
    await deleteDesigns([entry.filePath])
    onChanged()
  }

  return (
    <div
      className={
        'group relative flex flex-col overflow-hidden rounded-md border text-left transition-colors ' +
        (selected
          ? 'border-blue-500 ring-2 ring-blue-500/40'
          : isActive
            ? 'border-blue-500 ring-1 ring-blue-500'
            : 'border-neutral-200 hover:border-neutral-400 dark:border-neutral-700 dark:hover:border-neutral-500')
      }
    >
      <button
        onClick={(event) => {
          if (selecting || event.metaKey || event.ctrlKey) onToggle()
          else void openPath(entry.filePath)
        }}
        title={selecting ? undefined : 'Open (⌘/Ctrl-click to select)'}
        className="flex aspect-square w-full items-center justify-center bg-neutral-50 dark:bg-neutral-900"
      >
        {entry.preview ? (
          <img
            src={entry.preview}
            alt={entry.name}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <LayoutTemplate className="size-6 text-neutral-300" />
        )}
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        title={selected ? 'Deselect' : 'Select'}
        onClick={onToggle}
        className={
          'absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded border shadow-sm transition-opacity ' +
          (selected
            ? 'border-blue-500 bg-blue-500 text-white'
            : 'border-neutral-300 bg-white/90 text-transparent dark:border-neutral-600 dark:bg-neutral-800/90 ' +
              (selecting ? '' : 'opacity-0 group-hover:opacity-100'))
        }
      >
        <Check className="size-3.5" />
      </button>
      {openTab && (
        <span
          className={
            'pointer-events-none absolute top-1.5 right-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium shadow-sm ' +
            (isActive
              ? 'bg-blue-500 text-white'
              : 'bg-white/90 text-blue-600 dark:bg-neutral-800/90')
          }
        >
          {isActive ? 'Editing' : 'Open'}
        </span>
      )}
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
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.name}</span>
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const refresh = useCallback(() => {
    void window.desktop.invoke('library:list').then((list) => {
      setEntries(list)
      // Forget selected designs that are gone.
      setSelected((current) => {
        const present = new Set(list.map((entry) => entry.filePath))
        const kept = [...current].filter((filePath) => present.has(filePath))
        return kept.length === current.size ? current : new Set(kept)
      })
    })
  }, [])
  // New designs, renames, deletes and fresh thumbnails show up as they happen.
  useEffect(() => {
    refresh()
    return window.desktop.on('library:changed', refresh)
  }, [refresh])

  const toggle = (filePath: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(filePath)) next.add(filePath)
      return next
    })

  const removeSelected = async (): Promise<void> => {
    const count = selected.size
    const confirmed = await window.desktop.invoke('dialog:confirm', {
      message: count === 1 ? 'Move 1 design to the trash?' : `Move ${count} designs to the trash?`,
      detail: 'You can restore them from the system trash.',
      confirmLabel: 'Move to Trash'
    })
    if (!confirmed) return
    try {
      await deleteDesigns([...selected])
    } catch (error) {
      console.error('Delete failed', error)
      toast.error('Could not delete every design.')
    }
    setSelected(new Set())
    refresh()
  }

  return (
    <div className="flex h-full flex-col gap-2">
      {selected.size > 0 ? (
        <div className="flex h-8 items-center gap-2 text-xs">
          <span className="flex-1 font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Cancel
          </Button>
          <Button size="sm" variant="destructive" onClick={() => void removeSelected()}>
            <Trash2 className="size-3.5" />
            Delete
          </Button>
        </div>
      ) : (
        // The new design is a blank tab, not a library file yet — it joins
        // the list below as soon as the user puts something in it.
        <Button size="sm" onClick={() => tabs.newTab()}>
          <Plus className="size-3.5" />
          New design
        </Button>
      )}
      <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pb-2">
        {entries.map((entry) => (
          <DesignCard
            key={entry.filePath}
            entry={entry}
            onChanged={refresh}
            selected={selected.has(entry.filePath)}
            selecting={selected.size > 0}
            onToggle={() => toggle(entry.filePath)}
          />
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
  const tab = view.tab
  return (
    <div className="flex h-full flex-col">
      <SegmentedTabs
        value={tab}
        onValueChange={(value) => runInAction(() => (view.tab = value))}
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
