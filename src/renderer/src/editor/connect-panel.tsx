import { useEffect, useState } from 'react'
import { Bot, Check, Copy, Download, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from 'polotno/primitives/button'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from 'polotno/primitives/dialog'
import { Separator } from 'polotno/primitives/separator'

interface McpStatus {
  running: boolean
  url: string | null
  token: string
}

function cursorDeeplink(status: McpStatus): string {
  const config = btoa(
    JSON.stringify({
      url: status.url,
      headers: { Authorization: `Bearer ${status.token}` }
    })
  )
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=polotno&config=${encodeURIComponent(config)}`
}

function vscodeDeeplink(status: McpStatus): string {
  const config = JSON.stringify({
    name: 'polotno',
    type: 'http',
    url: status.url,
    headers: { Authorization: `Bearer ${status.token}` }
  })
  return `vscode:mcp/install?${encodeURIComponent(config)}`
}

function claudeCodeCommand(status: McpStatus): string {
  return `claude mcp add --transport http polotno ${status.url} --header "Authorization: Bearer ${status.token}"`
}

function rawConfig(status: McpStatus): string {
  return JSON.stringify(
    {
      polotno: {
        type: 'http',
        url: status.url,
        headers: { Authorization: `Bearer ${status.token}` }
      }
    },
    null,
    2
  )
}

function CopyRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full justify-start"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label}
    </Button>
  )
}

export function ConnectPanel(): React.JSX.Element {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    void window.desktop.invoke('mcp:getStatus').then(setStatus)
  }, [open])

  const openLink = (url: string): void => {
    void window.desktop.invoke('shell:openExternal', { url })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" className="mr-1 self-center">
            <Bot className="size-3.5" />
            Connect AI
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect an AI agent</DialogTitle>
          <DialogDescription>
            {status?.running
              ? `The local MCP server is running at ${status.url}. Any agent you connect can create, edit, see, and export your designs.`
              : 'The local MCP server is starting…'}
          </DialogDescription>
        </DialogHeader>
        {status?.running && status.url && (
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                void window.desktop.invoke('mcp:saveMcpb').then((result) => {
                  if (result) {
                    toast.success(`Saved. Double-click ${result.filePath} to install into Claude Desktop.`)
                  }
                })
              }}
            >
              <Download className="size-3.5" />
              Download for Claude Desktop (.mcpb)
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => openLink(cursorDeeplink(status))}
            >
              Add to Cursor
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => openLink(vscodeDeeplink(status))}
            >
              Add to VS Code
            </Button>
            <CopyRow label="Copy Claude Code command" value={claudeCodeCommand(status)} />
            <CopyRow label="Copy config JSON (any MCP client)" value={rawConfig(status)} />
            <Separator />
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                void window.desktop.invoke('mcp:regenerateToken').then(() => {
                  toast.info('Token regenerated. Previously connected agents must reconnect.')
                  void window.desktop.invoke('mcp:getStatus').then(setStatus)
                })
              }}
            >
              <RefreshCw className="size-3.5" />
              Regenerate token (disconnects agents)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
