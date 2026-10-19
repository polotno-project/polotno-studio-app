import { makeAutoObservable } from 'mobx'
import type { DesignCommand } from '../../../shared/commands'
import type { DocId } from '../../../shared/types'
import { elementRect, pageRect, type ScreenRect } from './canvas-rects'
import type { DesignStore } from './store'
import { agent } from './agent-model'
import { tabs } from './tabs-model'

// What agents are doing to each design right now, for the canvas cursors:
// every design command that comes over the bridge (from the AI panel or any
// connected agent) names what it reads or changes. Each AI panel chat has its
// own cursor (its agent names the chat); agents connected from outside share
// one. The latest command of each shows for a few seconds, longer while its
// chat is still working.

export type ActivityTarget =
  | { kind: 'element'; id: string }
  | { kind: 'page'; id: string }
  // Something already gone (removed): where it was when the command came in,
  // as fractions of its page (so it moves with the canvas), or on screen when
  // the page went too.
  | { kind: 'rect'; rect: ScreenRect; pageId?: string }

export type Activity = {
  // The AI panel chat it comes from; undefined for agents connected from
  // outside (Connect AI), which don't say who they are.
  chatId?: string
  // Who: the panel's agent, or "AI agent" for an outside one.
  agent: string
  // The cursor's color: one per chat on a design.
  color: string
  mode: 'read' | 'write'
  label: string
  targets: ActivityTarget[]
  // Bumped per command, so the overlay replays its highlight.
  seq: number
  // Shown long enough; the cursor stays only while the agent still works.
  stale: boolean
}

const HOLD_MS = 2500

// Outside agents get the first; chats take the others in turn.
const COLORS = ['#7c3aed', '#0891b2', '#db2777', '#ea580c', '#16a34a', '#2563eb']

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

// Per design: one activity per chat ('' for outside agents).
class AgentActivity {
  private byDoc = new Map<DocId, Map<string, Activity>>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private seq = 0
  // The visible editor's root, where removed elements are measured.
  root: Element | null = null

  constructor() {
    makeAutoObservable<this, 'timers'>(this, { timers: false, root: false })
    tabs.addCloseListener((docId) => this.forget(docId))
  }

  // Every cursor on the design, outside agents first, then chats in the
  // order they first touched it.
  get(docId: DocId): Activity[] {
    return [...(this.byDoc.get(docId)?.values() ?? [])]
  }

  forget(docId: DocId): void {
    for (const key of this.byDoc.get(docId)?.keys() ?? []) {
      clearTimeout(this.timers.get(`${docId}|${key}`))
      this.timers.delete(`${docId}|${key}`)
    }
    this.byDoc.delete(docId)
  }

  private measure(store: DesignStore, id: string): ActivityTarget | null {
    const rect = this.root && elementRect(this.root, store, id)
    if (!rect) return null
    const pageId = (store.getElementById(id) as { page?: { id: string } } | undefined)?.page?.id
    const page = this.root && pageId ? pageRect(this.root, pageId) : null
    if (!page) return { kind: 'rect', rect }
    return {
      kind: 'rect',
      pageId,
      rect: {
        x: (rect.x - page.x) / page.width,
        y: (rect.y - page.y) / page.height,
        width: rect.width / page.width,
        height: rect.height / page.height
      }
    }
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
  show(docId: DocId, plan: Plan, value: unknown, chatId?: string): void {
    const targets = [...plan.targets]
    const result = (value ?? {}) as { elementId?: string; pageId?: string }
    if (result.elementId) targets.push({ kind: 'element', id: result.elementId })
    if (result.pageId) targets.push({ kind: 'page', id: result.pageId })
    const key = chatId ?? ''
    const cursors = this.byDoc.get(docId) ?? new Map<string, Activity>()
    const previous = cursors.get(key)
    // A chat keeps its color; a new one takes the next no shown cursor uses.
    const used = new Set(
      [...cursors.values()]
        .filter((item) => !item.stale || agent.isChatRunning(item.chatId ?? null))
        .map((item) => item.color)
    )
    const color =
      previous?.color ??
      (chatId ? (COLORS.slice(1).find((c) => !used.has(c)) ?? COLORS[1]) : COLORS[0])
    cursors.set(key, {
      ...plan,
      chatId,
      agent: chatId ? agent.name : 'AI agent',
      color,
      targets,
      seq: ++this.seq,
      stale: false
    })
    this.byDoc.set(docId, cursors)
    const timer = `${docId}|${key}`
    clearTimeout(this.timers.get(timer))
    this.timers.set(
      timer,
      setTimeout(() => this.expire(docId, key), HOLD_MS)
    )
  }

  private expire(docId: DocId, key: string): void {
    this.timers.delete(`${docId}|${key}`)
    const cursors = this.byDoc.get(docId)
    const current = cursors?.get(key)
    if (cursors && current) cursors.set(key, { ...current, stale: true })
  }
}

export const agentActivity = new AgentActivity()
