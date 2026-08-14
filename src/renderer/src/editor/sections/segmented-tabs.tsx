import type { ReactNode } from 'react'

// In-panel segmented "pill" control, matching the new studio's SegmentedTabs
// (shadcn Tabs look): muted track, active segment raised on a background.
export function SegmentedTabs<T extends string>({
  value,
  onValueChange,
  tabs
}: {
  value: T
  onValueChange: (value: T) => void
  tabs: { value: T; label: ReactNode }[]
}): React.JSX.Element {
  return (
    <div className="mb-3 flex h-10 w-full shrink-0 items-center gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={value === tab.value}
          onClick={() => onValueChange(tab.value)}
          className={
            'h-full flex-1 rounded-md text-sm font-medium transition-colors ' +
            (value === tab.value
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-50'
              : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200')
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
