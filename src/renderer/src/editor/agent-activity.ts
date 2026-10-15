import { makeAutoObservable } from 'mobx'
import type { DesignCommand } from '../../../shared/commands'
import type { DocId } from '../../../shared/types'
import { elementRect, pageRect, type ScreenRect } from './canvas-rects'
import type { DesignStore } from './store'
import { agent } from './agent-model'
import { tabs } from './tabs-model'

// What an agent is doing to each design right now, for the canvas cursor:
// every design command that comes over the bridge (from the AI panel or any
// connected agent) names what it reads or changes. The latest one shows for a
// few seconds, longer while the panel's agent is still working.

export type ActivityTarget =
  | { kind: 'element'; id: string }
  | { kind: 'page'; id: string }
  // Something already gone (removed): where it was when the command came in.
  | { kind: 'rect'; rect: ScreenRect }

export type Activity = {
  // Who: the panel's agent while its turn runs; otherwise an agent connected
  // from outside (Connect AI), which doesn't say who it is.
  agent: string
  mode: 'read' | 'write'
  label: string
  targets: ActivityTarget[]
  // Bumped per command, so the overlay replays its highlight.
  seq: number
  // Shown long enough; the cursor stays only while the agent still works.
  stale: boolean
}

const HOLD_MS = 2500

type ElementLike = { id: string; type: string; name?: string; text?: string }

function quote(text: string): string {
  const plain = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > 24 ? `“${plain.slice(0, 23)}…”` : `“${plain}”`
}

const TYPE_NAMES: Record<string, string> = {
  text: 'text',
  image: 'an image',
  svg: 'a graphic',
  figure: 'a shape',
  line: 'a line',
  group: 'a group',
  video: 'a video',
  table: 'a table',
  gif: 'a GIF'
}

function describeElement(element: Partial<ElementLike> | undefined): string {
  if (!element) return 'an element'
  // Text says what it is best; names like "text-1" are generated ones.
  if (element.type === 'text' && element.text) return quote(element.text)
  if (element.name && !/^[a-z]+-\d+$/.test(element.name)) return quote(element.name)
  return TYPE_NAMES[element.type ?? ''] ?? 'an element'
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`
}

type Plan = { mode: Activity['mode']; label: string; targets: ActivityTarget[] }

function activePageId(store: DesignStore): string | undefined {
  return store.activePage?.id ?? store.pages[0]?.id
}

class AgentActivity {
  private byDoc = new Map<DocId, Activity>()
  private timers = new Map<DocId, ReturnType<typeof setTimeout>>()
  private seq = 0
  // The visible editor's root, where removed elements are measured.
  root: Element | null = null

  constructor() {
    makeAutoObservable<this, 'timers'>(this, { timers: false, root: false })
    tabs.addCloseListener((docId) => this.forget(docId))
  }

  get(docId: DocId): Activity | undefined {
    return this.byDoc.get(docId)
  }

  forget(docId: DocId): void {
    clearTimeout(this.timers.get(docId))
    this.timers.delete(docId)
    this.byDoc.delete(docId)
  }

  private measure(store: DesignStore, id: string): ActivityTarget | null {
    const rect = this.root && elementRect(this.root, store, id)
    return rect ? { kind: 'rect', rect } : null
  }

  private measurePage(id: string): ActivityTarget | null {
    const rect = this.root && pageRect(this.root, id)
    return rect ? { kind: 'rect', rect } : null
  }

  // Before the command runs: removed things are measured while they exist.
  // Returns what to show once it has run (null: nothing worth showing).
  plan(store: DesignStore, command: DesignCommand): Plan | null {
    const element = (id: string): ElementLike | undefined =>
      store.getElementById(id) as ElementLike | undefined
    const page = (id?: string): ActivityTarget[] => {
      const pageId = id ?? activePageId(store)
      return pageId ? [{ kind: 'page', id: pageId }] : []
    }

    switch (command.type) {
      case 'get_json':
      case 'get_info':
        return { mode: 'read', label: 'Reading the design', targets: page() }
      case 'render':
        return { mode: 'read', label: 'Looking at the design', targets: page(command.pageId) }
      case 'lint':
        return { mode: 'read', label: 'Checking the layout', targets: page(command.pageId) }
      case 'export':
        return { mode: 'read', label: 'Exporting', targets: page(command.pageId) }
      case 'load_json':
        return { mode: 'write', label: 'Rewriting the design', targets: page() }
      case 'set_size':
        return { mode: 'write', label: 'Resizing the design', targets: page() }
      case 'add_page':
        return { mode: 'write', label: 'Adding a page', targets: [] }
      case 'remove_page': {
        const gone = this.measurePage(command.pageId)
        return { mode: 'write', label: 'Removing a page', targets: gone ? [gone] : [] }
      }
      case 'move_page':
        return { mode: 'write', label: 'Reordering pages', targets: page(command.pageId) }
      case 'set_page':
        return { mode: 'write', label: 'Editing the page', targets: page(command.pageId) }
      case 'add_element':
        return {
          mode: 'write',
          label: `Adding ${describeElement(command.element as Partial<ElementLike>)}`,
          targets: []
        }
      case 'update_element':
      case 'move_element':
        return {
          mode: 'write',
          label: `${command.type === 'update_element' ? 'Editing' : 'Arranging'} ${describeElement(element(command.elementId))}`,
          targets: [{ kind: 'element', id: command.elementId }]
        }
      case 'remove_elements': {
        const ids = command.elementIds
        return {
          mode: 'write',
          label: `Removing ${ids.length === 1 ? describeElement(element(ids[0])) : `${ids.length} elements`}`,
          targets: ids.map((id) => this.measure(store, id)).filter((t): t is ActivityTarget => !!t)
        }
      }
      case 'apply_changes': {
        const edited: string[] = []
        const added: Partial<ElementLike>[] = []
        const targets: ActivityTarget[] = []
        let removed = 0
        for (const change of command.changes) {
          if (change.kind === 'set' && change.target === 'element') {
            edited.push(change.id)
            targets.push({ kind: 'element', id: change.id })
          } else if (change.kind === 'set' && change.target === 'page') {
            targets.push(...page(change.id))
          } else if (change.kind === 'add-element') {
            const json = change.element as Partial<ElementLike>
            added.push(json)
            if (json.id) targets.push({ kind: 'element', id: json.id })
          } else if (change.kind === 'remove-element') {
            removed++
            const gone = this.measure(store, change.id)
            if (gone) targets.push(gone)
          } else if (change.kind === 'size') {
            targets.push(...page())
          }
        }
        const parts: string[] = []
        if (edited.length)
          parts.push(
            `Editing ${edited.length === 1 ? describeElement(element(edited[0])) : `${edited.length} elements`}`
          )
        if (added.length)
          parts.push(
            `${parts.length ? 'adding' : 'Adding'} ${added.length === 1 ? describeElement(added[0]) : `${added.length} elements`}`
          )
        if (removed)
          parts.push(
            `${parts.length ? 'removing' : 'Removing'} ${count(removed, 'an element', 'elements')}`
          )
        return {
          mode: 'write',
          label: parts.length ? parts.join(', ') : 'Editing the design',
          targets
        }
      }
      default:
        return null
    }
  }

  // After the command ran: new things are where the agent is now.
  show(docId: DocId, plan: Plan, value: unknown): void {
    const targets = [...plan.targets]
    const result = (value ?? {}) as { elementId?: string; pageId?: string }
    if (result.elementId) targets.push({ kind: 'element', id: result.elementId })
    if (result.pageId) targets.push({ kind: 'page', id: result.pageId })
    const name = agent.isRunning(docId) ? agent.name : 'AI agent'
    this.byDoc.set(docId, { ...plan, agent: name, targets, seq: ++this.seq, stale: false })
    clearTimeout(this.timers.get(docId))
    this.timers.set(
      docId,
      setTimeout(() => this.expire(docId), HOLD_MS)
    )
  }

  private expire(docId: DocId): void {
    const current = this.byDoc.get(docId)
    if (current) this.byDoc.set(docId, { ...current, stale: true })
  }
}

export const agentActivity = new AgentActivity()
