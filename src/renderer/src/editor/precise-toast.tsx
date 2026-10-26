import { toast } from 'sonner'

interface PreciseToast {
  title: string
  text: string
  hint: string
  action: string
  onAction: () => void
}

// Sonner's toast look, plus a muted line under both the text and the button
// (its own toast puts everything in one row, next to the button).
export function showPreciseToast({ title, text, hint, action, onAction }: PreciseToast): void {
  toast.custom(
    (id) => (
      <div className="flex w-(--width) flex-col gap-2 rounded-(--border-radius) border border-(--normal-border) bg-(--normal-bg) p-4 text-[13px] text-(--normal-text) shadow-[0_4px_12px_rgba(0,0,0,0.1)]">
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="leading-normal font-medium">{title}</div>
            <div className="leading-[1.4]">{text}</div>
          </div>
          <button
            type="button"
            className="flex h-6 shrink-0 cursor-pointer items-center rounded px-2 text-xs font-medium text-(--normal-bg) bg-(--normal-text)"
            onClick={() => {
              toast.dismiss(id)
              onAction()
            }}
          >
            {action}
          </button>
        </div>
        <div className="text-xs leading-[1.4] opacity-60">{hint}</div>
      </div>
    ),
    // Long enough to look at the result first.
    { duration: 10_000 }
  )
}
