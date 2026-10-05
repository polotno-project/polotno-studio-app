import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

// JSON-RPC over stdio (newline-delimited JSON, no "jsonrpc" header) with a
// `codex app-server` child. Requests are promise-correlated; notifications and
// server-initiated requests go to the handlers the session installs.

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void }

export interface AppServerHandlers {
  onNotification: (method: string, params: Record<string, unknown>) => void
  // Answer a server-initiated request (approvals, elicitations). Throwing
  // replies with a JSON-RPC error.
  onRequest: (method: string, params: Record<string, unknown>) => Promise<unknown>
  onExit: (code: number | null) => void
}

export class AppServer {
  private proc: ChildProcessWithoutNullStreams
  private nextId = 1
  private pending = new Map<number, Pending>()
  private stderrTail = ''
  // Set once the process is gone: later requests fail at once instead of
  // waiting forever for a reply that cannot come.
  private closed: Error | null = null

  constructor(binary: string, env: NodeJS.ProcessEnv, handlers: AppServerHandlers) {
    this.proc = spawn(binary, ['app-server'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stderr.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-4000)
    })
    this.proc.on('error', (error) => this.failAll(error))
    this.proc.stdin.on('error', (error) => this.failAll(error))
    this.proc.on('exit', (code) => {
      this.failAll(new Error(`codex app-server exited (${code}): ${this.stderrTail.trim()}`))
      handlers.onExit(code)
    })

    createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let message: {
        id?: number
        method?: string
        params?: Record<string, unknown>
        result?: unknown
        error?: { message?: string }
      }
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.method && message.id !== undefined) {
        const id = message.id
        handlers
          .onRequest(message.method, message.params ?? {})
          .then((result) => this.write({ id, result }))
          .catch((error: Error) =>
            this.write({ id, error: { code: -32000, message: error.message } })
          )
      } else if (message.method) {
        handlers.onNotification(message.method, message.params ?? {})
      } else if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message ?? 'codex request failed'))
        else entry.resolve(message.result)
      }
    })
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) return Promise.reject(this.closed)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.write({ method, id, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params })
  }

  stop(): void {
    this.proc.kill()
  }

  private write(message: unknown): void {
    if (this.proc.stdin.writable) this.proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private failAll(error: Error): void {
    this.closed ??= error
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }
}
