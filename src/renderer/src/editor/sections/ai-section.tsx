import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { SectionTab, type Section } from 'polotno/side-panel'
import { selectImage } from 'polotno/side-panel/select-image'
import { unstable_registerNextDomDrop } from 'polotno/config'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ImageIcon,
  ImagePlus,
  RotateCcw,
  Sparkles,
  Square,
  Wallpaper,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { useStickToBottom } from 'use-stick-to-bottom'
import { Button } from 'polotno/primitives/button'
import { Spinner } from 'polotno/primitives/spinner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from 'polotno/primitives/dropdown-menu'
import type { AgentEntry, AgentId } from '../../../../shared/agent'
import { agent } from '../agent-model'
import { Markdown } from './ai-markdown'
import { tabs } from '../tabs-model'

// The AI side panel: a prompt box that runs the user's own agent (their own
// install and sign-in, see src/main/agents) against the active design, and a
// feed of what the agent is doing. The edits themselves show up live on the
// canvas.

const TOOL_LABELS: Record<string, string> = {
  read_mcp_resource: 'Reading the design guide',
  'codex.list_mcp_resources': 'Reading the design guide',
  'codex.list_mcp_resource_templates': 'Reading the design guide',
  ListMcpResourcesTool: 'Reading the design guide',
  ReadMcpResourceTool: 'Reading the design guide',
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

// Only Codex generates images.
const SUGGESTIONS: Record<AgentId, string[]> = {
  codex: [
    'Make a poster for a jazz night on Friday at 9 pm',
    'Generate a background image that fits this design',
    'Improve the typography and spacing'
  ],
  claude: [
    'Make a poster for a jazz night on Friday at 9 pm',
    'Suggest a color palette and apply it',
    'Improve the typography and spacing'
  ]
}

const ABILITIES: Record<AgentId, string> = {
  codex: 'It can write, lay out, and generate images.',
  claude: 'It can write and lay out; it does not generate images.'
}

const toolLabel = (tool: string): string => TOOL_LABELS[tool] ?? tool

const ToolRow = observer(function ToolRow({
  entry,
  count
}: {
  entry: Extract<AgentEntry, { kind: 'tool' }>
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

// The card shows a small preview; these fetch the full image from main.
async function addImage(
  id: string,
  droppedPos?: { x: number; y: number },
  targetElement?: Parameters<typeof selectImage>[0]['targetElement']
): Promise<void> {
  const store = tabs.active?.store
  if (!store) return
  const { dataUrl } = await window.desktop.invoke('agent:image', { id })
  await selectImage({ src: dataUrl, store, droppedPos, targetElement })
}

async function setBackground(id: string): Promise<void> {
  const page = tabs.active?.store.activePage
  if (!page) return
  const { dataUrl } = await window.desktop.invoke('agent:image', { id })
  page.set({ background: dataUrl })
}

const failed = (error: Error): void => {
  toast.error(`Could not add the image: ${error.message}`)
}

const ImageCard = observer(function ImageCard({
  entry
}: {
  entry: Extract<AgentEntry, { kind: 'image' }>
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
      <div className="flex aspect-square w-full items-center justify-center bg-neutral-50 dark:bg-neutral-900">
        {entry.preview ? (
          <img
            src={entry.preview}
            alt={entry.prompt ?? 'Generated image'}
            title="Drag onto the design"
            draggable
            onDragStart={() =>
              unstable_registerNextDomDrop((pos, element) =>
                addImage(entry.id, pos, element).catch(failed)
              )
            }
            onDragEnd={() => unstable_registerNextDomDrop(null)}
            className="h-full w-full cursor-grab object-cover"
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
      {entry.preview && (
        <div className="flex gap-1 border-t border-neutral-200 p-1 dark:border-neutral-700">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => addImage(entry.id).catch(failed)}
          >
            <ImagePlus className="size-3.5" />
            Add to design
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => setBackground(entry.id).catch(failed)}
          >
            <Wallpaper className="size-3.5" />
            Background
          </Button>
        </div>
      )}
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
  entry: AgentEntry
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

// Which model answers. The pick is kept across launches and applies
// from the next message on.
const ModelPicker = observer(function ModelPicker(): React.JSX.Element | null {
  const current = agent.currentModel
  if (!current) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" title="Model" className="text-neutral-500">
            {current.name}
            <ChevronDown className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        {agent.models.models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            onSelect={() => agent.pickModel(model.id)}
            className="items-start"
          >
            <Check
              className={`mt-0.5 size-3.5 shrink-0 ${model.id === current.id ? '' : 'invisible'}`}
            />
            <div className="min-w-0">
              <div>{model.name}</div>
              {model.description && (
                <div className="text-xs text-neutral-500">{model.description}</div>
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

const Composer = observer(function Composer({ docId }: { docId: string }): React.JSX.Element {
  const [prompt, setPrompt] = useState('')
  const running = agent.isRunning(docId)
  const started = agent.feed(docId).length > 0

  // While the agent works, a message joins the running turn.
  const submit = (): void => {
    const value = prompt.trim()
    if (!value) return
    setPrompt('')
    send(docId, value)
  }

  const placeholder = running
    ? `Add to the request or answer ${agent.name}…`
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
        <div className="flex items-center gap-1 p-1.5">
          <ModelPicker />
          <div className="flex-1" />
          {running && (
            <Button
              variant="ghost"
              size="sm"
              title="Stop"
              onClick={() => void window.desktop.invoke('agent:stop', { docId })}
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
  window.desktop.invoke('agent:run', { docId, prompt }).catch((error: Error) => {
    toast.error(`${agent.name} could not start: ${error.message}`)
  })
}

// Consecutive calls of the same step ("Adding an element" eight times) read as
// noise; show them as one row with a count, keyed by the latest call.
function collapseTools(feed: AgentEntry[]): { entry: AgentEntry; count: number }[] {
  const rows: { entry: AgentEntry; count: number }[] = []
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
  const feed = agent.feed(docId)
  const running = agent.isRunning(docId)
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
          {agent.name} edits this design live. {ABILITIES[agent.active]}
        </div>
        <div className="flex flex-col gap-1.5">
          {SUGGESTIONS[agent.active].map((suggestion) => (
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

// Which agent runs: the user's own Codex or Claude Code. Switching starts a
// new conversation in every design.
const AgentPicker = observer(function AgentPicker(): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            title="Choose the AI agent"
            className="flex items-center gap-1 rounded text-sm font-medium hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            {agent.name}
            <ChevronDown className="size-3.5" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        {agent.agents.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => agent.setActive(item.id)}>
            <Check className={`size-3.5 ${item.id === agent.active ? '' : 'invisible'}`} />
            {item.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

const Command = observer(function Command({ children }: { children: string }): React.JSX.Element {
  return (
    <code className="select-text rounded bg-neutral-100 px-2 py-1 text-xs dark:bg-neutral-800">
      {children}
    </code>
  )
})

const isWindows = navigator.userAgent.includes('Windows')

// What to do when the agent isn't installed or signed in, per agent.
const SETUP: Record<
  AgentId,
  { install: React.ReactNode; signIn: React.ReactNode; signInAction?: boolean }
> = {
  codex: {
    install: (
      <>
        <p>Polotno generates with your own Codex. Install the Codex CLI, then try again:</p>
        <Command>npm install -g @openai/codex</Command>
      </>
    ),
    signIn: 'Codex uses your ChatGPT plan. Sign in once; Codex keeps you signed in.',
    signInAction: true
  },
  claude: {
    install: (
      <>
        <p>Polotno generates with your own Claude Code. Install it, then try again:</p>
        <Command>
          {isWindows
            ? 'irm https://claude.ai/install.ps1 | iex'
            : 'curl -fsSL https://claude.ai/install.sh | bash'}
        </Command>
      </>
    ),
    signIn: (
      <>
        <p>
          Claude Code uses your Claude plan (Pro, Max, Team or Enterprise). Sign in once in a
          terminal, then try again:
        </p>
        <Command>claude auth login</Command>
      </>
    )
  }
}

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
  const status = agent.status

  useEffect(() => {
    agent.refreshStatus()
  }, [])

  const retry = (
    <Button variant="outline" size="sm" onClick={() => agent.refreshStatus()}>
      <RotateCcw className="size-3.5" />
      Try again
    </Button>
  )

  let body: React.ReactNode
  if (status.state === 'starting') {
    body = (
      <StatusMessage>
        <Spinner className="size-5" />
        Starting {agent.name}…
      </StatusMessage>
    )
  } else if (status.state === 'missing') {
    body = <StatusMessage action={retry}>{SETUP[agent.active].install}</StatusMessage>
  } else if (status.state === 'signedOut') {
    const setup = SETUP[agent.active]
    body = (
      <StatusMessage
        action={
          setup.signInAction ? (
            <Button size="sm" onClick={() => void window.desktop.invoke('agent:signIn')}>
              Sign in with ChatGPT
            </Button>
          ) : (
            retry
          )
        }
      >
        {setup.signIn}
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
          <AgentPicker />
          {status.state === 'ready' && (
            <div className="truncate text-[11px] text-neutral-500">
              {[status.email, status.plan].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
        {status.state === 'ready' && docId && agent.feed(docId).length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            disabled={agent.isRunning(docId)}
            onClick={() => agent.clear(docId)}
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
