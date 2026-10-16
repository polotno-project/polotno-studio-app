import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { observer } from 'mobx-react-lite'
import { AlertTriangle } from 'lucide-react'
import { Button } from 'polotno/primitives/button'
import { Spinner } from 'polotno/primitives/spinner'
import { agent } from './agent-model'

// The canvas AI tools (Generative fill, Expand) run on the user's Codex,
// whichever agent the AI panel chats with. When Codex can't run them, a
// callout at the top of Polotno's edit panel says so before Generate.

// Polotno's edit panel takes only text, so the callout goes into a node we
// put at the top of its form (the form remounts per tool and element).
function useEditPanelHost(): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let current: HTMLElement | null = null
    const sync = (): void => {
      const form = document.querySelector('.polotno-image-edit-panel')
      if (form && current?.parentElement === form) return
      current?.remove()
      current = null
      if (form) {
        current = document.createElement('div')
        form.prepend(current)
      }
      setHost(current)
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true })
    sync()
    return () => {
      observer.disconnect()
      current?.remove()
    }
  }, [])
  return host
}

export const CodexNotice = observer(function CodexNotice(): React.JSX.Element | null {
  const host = useEditPanelHost()
  const status = agent.codexStatus
  if (!host || !status || status.state === 'ready' || status.state === 'starting') return null

  let title: string
  let body: React.ReactNode
  if (status.state === 'missing') {
    title = 'Codex is not installed'
    body = (
      <>
        <p>AI edits run on your own Codex. Install the Codex CLI, then check again:</p>
        <code className="block rounded bg-white/70 px-2 py-1 text-xs select-text dark:bg-black/30">
          npm install -g @openai/codex
        </code>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => agent.refreshCodexStatus()}
        >
          Check again
        </Button>
      </>
    )
  } else if (status.state === 'signingIn') {
    title = 'Signing in to Codex'
    body = (
      <p className="flex items-center gap-2">
        <Spinner className="size-3.5" />
        Finish signing in in your browser.
      </p>
    )
  } else {
    title = 'Codex is not connected'
    body = (
      <>
        <p>
          {status.state === 'error'
            ? `AI edits run on your own Codex: ${status.message}`
            : 'AI edits run on your own Codex. Sign in with your ChatGPT plan to use them.'}
        </p>
        {/* Signs in to Codex only: the AI panel keeps chatting with its agent. */}
        <Button
          type="button"
          size="sm"
          onClick={() => void window.desktop.invoke('imageEdit:signIn')}
        >
          Sign in to Codex
        </Button>
      </>
    )
  }

  return createPortal(
    <div
      role="alert"
      className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
        <p className="font-semibold">{title}</p>
        {body}
      </div>
    </div>,
    host
  )
})
