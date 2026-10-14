import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { SectionTab, type Section } from 'polotno/side-panel'
import { ArrowDown, ArrowUp, Check, ImageIcon, RotateCcw, Sparkles, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStickToBottom } from 'use-stick-to-bottom'
import { Button } from 'polotno/primitives/button'
import { Spinner } from 'polotno/primitives/spinner'
import type { CodexEntry } from '../../../../shared/codex'
import { codex } from '../codex-model'
import { Markdown } from './ai-markdown'
import { tabs } from '../tabs-model'

// The AI side panel: a prompt box that runs Codex (through the user's own
// Codex install and ChatGPT sign-in) against the active design, and a feed of
// what Codex is doing. The edits themselves show up live on the canvas.

const TOOL_LABELS: Record<string, string> = {
  read_mcp_resource: 'Reading the design guide',
  'codex.list_mcp_resources': 'Reading the design guide',
  'codex.list_mcp_resource_templates': 'Reading the design guide',
  list_designs: 'Looking at open designs',
  get_design_info: 'Reading the design',
  get_design_json: 'Reading the design',
  set_design_size: 'Resizing the design',
  add_page: 'Adding a page',
  set_page: 'Updating the page',
  add_element: 'Adding an element',
  update_element: 'Updating an element',
  remove_element: 'Removing elements',
  move_element: 'Reordering elements',
  patch_design_json: 'Editing the design',
  place_image: 'Placing the image',
  render_page: 'Looking at the result',
  lint_design: 'Checking the design',
  export_design: 'Exporting',
  shell: 'Running a command'
}

const SUGGESTIONS = [
  'Make a poster for a jazz night on Friday at 9 pm',
  'Generate a background image that fits this design',
  'Improve the typography and spacing'
]

const toolLabel = (tool: string): string => TOOL_LABELS[tool] ?? tool

const ToolRow = observer(function ToolRow({
  entry,
  count
}: {
  entry: Extract<CodexEntry, { kind: 'tool' }>
  count: number
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-1 text-xs text-neutral-500" title={entry.error}>
      {entry.status === 'running' ? (
        <Spinner className="size-3" />
      ) : entry.status === 'failed' ? (
        <X className="size-3 text-red-500" />
      ) : (
        <Check className="size-3 text-emerald-600" />
      )}
      <span className="truncate">{toolLabel(entry.tool)}</span>
      {count > 1 && <span className="text-neutral-400">×{count}</span>}
    </div>
  )
})

const ImageCard = observer(function ImageCard({
  entry
}: {
  entry: Extract<CodexEntry, { kind: 'image' }>
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
      <div className="flex aspect-square w-full items-center justify-center bg-neutral-50 dark:bg-neutral-900">
        {entry.preview ? (
          <img
            src={entry.preview}
            alt={entry.prompt ?? 'Generated image'}
            className="h-full w-full object-cover"
          />
        ) : entry.status === 'failed' ? (
          <X className="size-6 text-red-500" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-xs text-neutral-500">
            <Spinner className="size-5" />
            Generating image…
          </div>
        )}
      </div>
      {entry.prompt && (
        <div className="flex gap-1.5 px-2 py-1.5 text-[11px] leading-snug text-neutral-500">
          <ImageIcon className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-3">{entry.prompt}</span>
        </div>
      )}
    </div>
  )
})

const FeedEntry = observer(function FeedEntry({
  entry
}: {
  entry: CodexEntry
}): React.JSX.Element | null {
  switch (entry.kind) {
    case 'prompt':
      return (
        <div className="ml-6 self-end whitespace-pre-wrap rounded-lg bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
          {entry.text}
        </div>
      )
    case 'message':
      return entry.text ? <Markdown text={entry.text} streaming={!entry.done} /> : null
    case 'tool':
      return <ToolRow entry={entry} count={1} />
    case 'image':
      return <ImageCard entry={entry} />
    case 'error':
      return (
        <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {entry.text}
        </div>
      )
  }
})

const Composer = observer(function Composer({ docId }: { docId: string }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const running = codex.isRunning(docId)
  const started = codex.feed(docId).length > 0

  // While Codex works, a message joins the running turn (main steers it).
  const submit = (): void => {
    const value = prompt.trim()
    if (!value) return
    setPrompt('')
    send(docId, value)
  }

  const placeholder = running
    ? 'Add to the request or answer Codex…'
    : started
      ? 'Reply or ask for a change…'
      : 'Describe what to make or change…'

  return (
    <div className="border-t border-neutral-200 p-2 dark:border-neutral-700">
      <div className="flex flex-col rounded-lg border border-neutral-300 bg-white focus-within:border-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:focus-within:border-neutral-400">
        <textarea
          value={prompt}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          className="max-h-40 min-h-12 resize-none bg-transparent px-3 pt-2 text-sm outline-none [field-sizing:content] placeholder:text-neutral-400"
        />
        <div className="flex items-center justify-end gap-1 p-1.5">
          {running && (
            <Button
              variant="ghost"
              size="sm"
              title="Stop"
              onClick={() => void window.desktop.invoke('codex:stop', { docId })}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          )}
          <Button
            size="icon-sm"
            title="Send"
            aria-label="Send"
            disabled={!prompt.trim()}
            onClick={submit}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
})

function send(docId: string, prompt: string): void {
  window.desktop.invoke('codex:run', { docId, prompt }).catch((error: Error) => {
    toast.error(`Codex could not start: ${error.message}`)
  })
}

// Consecutive calls of the same step ("Adding an element" eight times) read as
// noise; show them as one row with a count, keyed by the latest call.
function collapseTools(feed: CodexEntry[]): { entry: CodexEntry; count: number }[] {
  const rows: { entry: CodexEntry; count: number }[] = []
  for (const entry of feed) {
    const previous = rows[rows.length - 1]
    if (
      entry.kind === 'tool' &&
      previous?.entry.kind === 'tool' &&
      toolLabel(previous.entry.tool) === toolLabel(entry.tool) &&
      previous.entry.status !== 'failed' &&
      entry.status !== 'failed'
    ) {
      rows[rows.length - 1] = { entry, count: previous.count + 1 }
    } else {
      rows.push({ entry, count: 1 })
    }
  }
  return rows
}

const Feed = observer(function Feed({ docId }: { docId: string }): React.JSX.Element {
  const feed = codex.feed(docId)
  const running = codex.isRunning(docId)
  const last = feed[feed.length - 1]
  // Follows new text only while the user is at the bottom; scrolling up
  // detaches it until they scroll back or press the arrow.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'smooth'
  })

  if (feed.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-8">
        <div className="flex flex-col items-center gap-2 text-center text-sm text-neutral-500">
          <Sparkles className="size-6 text-neutral-300" />
          Codex edits this design live. It can write, lay out, and generate images.
        </div>
        <div className="flex flex-col gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="rounded-md border border-neutral-200 px-3 py-2 text-left text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              onClick={() => send(docId, suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div ref={contentRef} className="flex flex-col gap-2 p-2">
          {/* shrink-0: in an overflowing flex column, entries would otherwise
              squash (the image card collapsed to its border). */}
          {collapseTools(feed).map(({ entry, count }) => (
            <div key={entry.id} className="flex shrink-0 flex-col">
              {entry.kind === 'tool' ? (
                <ToolRow entry={entry} count={count} />
              ) : (
                <FeedEntry entry={entry} />
              )}
            </div>
          ))}
          {running && last?.kind !== 'tool' && last?.kind !== 'image' && (
            <div className="flex items-center gap-2 px-1 text-xs text-neutral-500">
              <Spinner className="size-3" />
              Working…
            </div>
          )}
        </div>
      </div>
      {!isAtBottom && (
        <Button
          variant="outline"
          size="icon-sm"
          title="Jump to latest"
          aria-label="Jump to latest"
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white shadow-md dark:bg-neutral-900"
          onClick={() => void scrollToBottom()}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  )
})

const StatusMessage = observer(function StatusMessage({
  children,
  action
}: {
  children: React.ReactNode
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-neutral-600 dark:text-neutral-300">
      {children}
      {action}
    </div>
  )
})

const Panel = observer(function Panel(): React.JSX.Element {
  const docId = tabs.activeDocId
  const status = codex.status

  useEffect(() => {
    codex.refreshStatus()
  }, [])

  const retry = (
    <Button variant="outline" size="sm" onClick={() => codex.refreshStatus()}>
      <RotateCcw className="size-3.5" />
      Try again
    </Button>
  )

  let body: React.ReactNode
  if (status.state === 'starting') {
    body = (
      <StatusMessage>
        <Spinner className="size-5" />
        Starting Codex…
      </StatusMessage>
    )
  } else if (status.state === 'missing') {
    body = (
      <StatusMessage action={retry}>
        <p>Polotno generates with your own Codex. Install the Codex CLI, then try again:</p>
        <code className="rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
          npm install -g @openai/codex
        </code>
      </StatusMessage>
    )
  } else if (status.state === 'signedOut') {
    body = (
      <StatusMessage
        action={
          <Button size="sm" onClick={() => void window.desktop.invoke('codex:signIn')}>
            Sign in with ChatGPT
          </Button>
        }
      >
        Codex uses your ChatGPT plan. Sign in once; Codex keeps you signed in.
      </StatusMessage>
    )
  } else if (status.state === 'signingIn') {
    body = (
      <StatusMessage>
        <Spinner className="size-5" />
        Finish signing in in your browser…
      </StatusMessage>
    )
  } else if (status.state === 'error') {
    body = <StatusMessage action={retry}>{status.message}</StatusMessage>
  } else if (!docId) {
    body = <StatusMessage>Open a design to start.</StatusMessage>
  } else {
    body = (
      <>
        <Feed docId={docId} />
        <Composer docId={docId} />
      </>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <Sparkles className="size-4" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Codex</div>
          {status.state === 'ready' && (
            <div className="truncate text-[11px] text-neutral-500">
              {[status.email, status.plan && `ChatGPT ${status.plan}`].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {status.state === 'ready' && docId && codex.feed(docId).length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={codex.isRunning(docId)}
            onClick={() => codex.clear(docId)}
          >
            New chat
          </Button>
        )}
      </div>
      {body}
    </div>
  )
})

export const AiSection: Section = {
  name: 'ai',
  Tab: ((props: { onClick: () => void; active: boolean }) => (
    <SectionTab name="AI" {...props}>
      <Sparkles className="mx-auto size-6" />
    </SectionTab>
  )) as unknown as Section['Tab'],
  Panel: Panel as unknown as Section['Panel']
}
