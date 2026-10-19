import { z } from 'zod'
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import { applyPatch, type Operation } from 'fast-json-patch'
import { validateDesign } from '@polotno/schema'
import { currentChat, rpc } from './bridge-client'
import { readLocalImage } from './local-image'
import { elideDataUrls, hasDataRefs, restoreDataUrls } from './data-urls'
import { diffDesign, isEqual } from '../shared/design-diff'
import { compactDesign, outlineDesign } from '../shared/compact-design'
import {
  EXPORT_EXTENSIONS,
  type CommandResult,
  type DesignCommand,
  type DesignDefaults,
  type ExportFormat
} from '../shared/commands'

// The agent-facing tool surface, defined once as a transport-neutral registry:
// MCP registration and the plain-HTTP dispatcher in index.ts both consume it.
// Typed tools for targeted edits, raw JSON get/patch as the universal escape
// hatch, render + lint as the agent's eyes.

// A json result may carry a render of the page it changed (check: true).
export type ToolResult =
  { kind: 'json'; value: unknown; image?: string } | { kind: 'image'; dataUrl: string }

export interface ToolDef {
  name: string
  description: string
  schema: Record<string, z.ZodType>
  handler: (args: Record<string, never>) => Promise<ToolResult>
}

// Canonical skill verbs (reference/commands.md in the polotno-design skill)
// that differ from the tool names. Both spellings work over HTTP.
export const VERB_ALIASES: Record<string, string> = {
  render: 'render_page',
  export: 'export_design',
  lint: 'lint_design',
  save: 'save_design'
}

export function resolveTool(verb: string): ToolDef | undefined {
  const name = VERB_ALIASES[verb] ?? verb
  return TOOLS.find((tool) => tool.name === name)
}

const json = (value: unknown): ToolResult => ({ kind: 'json', value })

function unwrap(result: CommandResult): { value: unknown; rev?: number } {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return { value: result.value, rev: result.rev }
}

async function exec(
  designId: string,
  command: DesignCommand
): Promise<{ value: unknown; rev?: number }> {
  return unwrap(await rpc('design.exec', { docId: designId, command }))
}

type Json = Record<string, unknown>
type DesignJson = { pages: { id: string; children: Json[] }[] }

// Agents write numeric weights (700); the file format only takes strings.
function coerceElement(element: Json): Json {
  const out = { ...element }
  if (typeof out.fontWeight === 'number') out.fontWeight = String(out.fontWeight)
  if (Array.isArray(out.children)) out.children = (out.children as Json[]).map(coerceElement)
  return out
}

// The store generates element ids on insert, nested group children
// included; the schema requires them, so the validation copy gets stand-ins.
function withPendingIds(element: Json, path = 'pending'): Json {
  const out = { ...element, id: element.id ?? path }
  if (Array.isArray(out.children)) {
    out.children = (out.children as Json[]).map((child, i) => withPendingIds(child, `${path}-${i}`))
  }
  return out
}

function findElement(children: Json[], id: string): Json | undefined {
  for (const child of children) {
    if (child.id === id) return child
    const nested = Array.isArray(child.children) && findElement(child.children as Json[], id)
    if (nested) return nested
  }
  return undefined
}

// Restores get_design_json's asset references in values that skip the
// element schema check (page backgrounds).
async function withAssets<T>(designId: string, value: T): Promise<T> {
  if (!hasDataRefs(value)) return value
  return restoreDataUrls(value, (await exec(designId, { type: 'get_json' })).value)
}

// Element edits are checked against the file-format schema before they reach
// the store. The live store accepts values a saved file cannot (fontWeight:
// 700), and a design saved with them refuses to reopen. Also swaps the short
// asset references get_design_json hands out back to their data URLs.
async function checkedEdit(
  designId: string,
  edit: { add: Json; pageId?: string } | { update: Json; elementId: string }
): Promise<Json> {
  const design = (await exec(designId, { type: 'get_json' })).value as DesignJson
  const candidate = structuredClone(design)
  let result: Json
  if ('add' in edit) {
    result = coerceElement(restoreDataUrls(edit.add, design))
    const page = candidate.pages.find((p) => p.id === edit.pageId) ?? candidate.pages[0]
    page?.children.push(withPendingIds(result))
  } else {
    result = coerceElement(restoreDataUrls(edit.update, design))
    const target = candidate.pages.map((p) => findElement(p.children, edit.elementId)).find(Boolean)
    if (target) Object.assign(target, withPendingIds({ ...result, id: target.id }))
  }
  const check = validateDesign(candidate)
  if (!check.valid) {
    throw new Error(
      `invalid_args: the element would make the design invalid: ${JSON.stringify(check.errors?.slice(0, 5))}`
    )
  }
  return result
}

// Polotno's defaults don't change while the app runs; asked once.
let defaults: Promise<DesignDefaults> | null = null

async function compact(id: string, design: unknown): Promise<unknown> {
  defaults ??= exec(id, { type: 'get_defaults' }).then(({ value }) => value as DesignDefaults)
  try {
    return compactDesign(design, await defaults)
  } catch {
    defaults = null
    return design
  }
}

// The page an id belongs to: a page id itself, or the page holding that
// element (at any depth).
function pageFor(design: DesignJson, id: string | undefined): string | undefined {
  if (!id) return undefined
  return design.pages.find((page) => page.id === id || findElement(page.children, id))?.id
}

const check = z
  .boolean()
  .optional()
  .describe(
    'Also return the render of the changed page and its lint findings, instead of calling render_page and lint_design'
  )

// The edit's result, plus the page's render and lint findings when asked.
// Renders the first page touched; lints all of them (the whole design when
// the edit spans pages).
async function checked(
  id: string,
  wanted: boolean | undefined,
  value: Json,
  targets: (string | undefined)[] = []
): Promise<ToolResult> {
  if (!wanted) return json(value)
  const design = (await exec(id, { type: 'get_json' })).value as DesignJson
  const pages = [...new Set(targets.map((target) => pageFor(design, target)).filter(Boolean))]
  const pageId = pages[0]
  const render = (await exec(id, { type: 'render', pageId })).value as { dataUrl: string }
  const findings = (await exec(id, { type: 'lint', pageId: pages.length > 1 ? undefined : pageId }))
    .value
  return { kind: 'json', value: { ...value, findings }, image: render.dataUrl }
}

const designId = z.string().describe('The design id (from list_designs or create_design)')

// The designs agents last read, by rev. A patch's index paths ("/pages/0/
// children/3") mean what they meant in the copy the agent read; the user may
// have added, removed, or edited elements since. Patching that copy and
// diffing it keeps the edit pointed at the right elements.
const READS_KEPT = 4
const reads = new Map<string, Map<number, unknown>>()

// What agents last saw of each page and element, by id: the latest read,
// plus what they changed themselves since. update_element and set_page
// compare against it, like a patch does against its read, so a property the
// user changed meanwhile keeps the user's value. Nodes the agents never saw
// (no read yet) are set directly. Kept per chat (outside agents share one):
// another chat's read must not hide the user's changes from this one.
const seen = new Map<string, Map<string, Json>>()

function seenKey(id: string): string {
  return `${currentChat() ?? ''}|${id}`
}

function rememberSeen(id: string, design: unknown): void {
  const nodes = new Map<string, Json>()
  const walk = (items: Json[]): void => {
    for (const item of items) {
      nodes.set(item.id as string, item)
      if (Array.isArray(item.children)) walk(item.children as Json[])
    }
  }
  const pages = (design as DesignJson | undefined)?.pages ?? []
  for (const page of pages) nodes.set(page.id, page as unknown as Json)
  walk(pages.flatMap((page) => page.children))
  seen.set(seenKey(id), nodes)
}

function sawChange(id: string, nodeId: string, props: Json): void {
  const node = seen.get(seenKey(id))?.get(nodeId)
  if (node) Object.assign(node, structuredClone(props))
}

// Sets props on a page or element as one undo step, keeping the ones the user
// changed since the agent saw them. Returns what was kept, if anything.
async function setSeen(
  id: string,
  target: 'element' | 'page',
  nodeId: string,
  props: Json
): Promise<{ rev?: number; skipped?: unknown[] } | null> {
  const known = seen.get(seenKey(id))?.get(nodeId)
  if (!known) return null
  const base = Object.fromEntries(Object.keys(props).map((key) => [key, known[key]]))
  const { value, rev } = await exec(id, {
    type: 'apply_changes',
    changes: [{ kind: 'set', target, id: nodeId, props, base }]
  })
  const { skipped } = value as { skipped: { reason: string; props?: string[] }[] }
  if (skipped.some((item) => !item.props)) {
    throw new Error(`${target}_not_found: ${nodeId} (${skipped[0].reason})`)
  }
  const kept = new Set(skipped.flatMap((item) => item.props ?? []))
  sawChange(id, nodeId, Object.fromEntries(Object.entries(props).filter(([key]) => !kept.has(key))))
  return { rev, skipped: skipped.length ? skipped : undefined }
}

const KEPT_NOTE =
  'The user changed these while you worked; their values were kept. Re-read before changing them again.'

function rememberRead(id: string, rev: number | undefined, value: unknown): void {
  rememberSeen(id, value)
  if (rev === undefined) return
  const byRev = reads.get(id) ?? new Map<number, unknown>()
  byRev.delete(rev)
  byRev.set(rev, value)
  while (byRev.size > READS_KEPT) byRev.delete(byRev.keys().next().value as number)
  reads.set(id, byRev)
}

// Above this (characters of compact JSON) agents' tool-result limits cut the
// read off: Claude Code saves a text result over 50,000 characters to a file
// in ~/.claude/projects (no setting turns that off) and hands the model a
// pointer, so the design would land on disk outside the app.
const FULL_DESIGN_LIMIT = 40_000

const OUTLINE_NOTE =
  'Pages with "outlined": true list their elements under "outline" in children order, one line each ("<id> <type> <x>,<y> <width>x<height> \\"text\\""), or only an elementCount; read them in full with get_design_json({pages: [index]}). Patch paths (/pages/i/children/j) address the full design either way.'

/* eslint-disable @typescript-eslint/no-explicit-any */
export const TOOLS: ToolDef[] = [
  {
    name: 'list_designs',
    description:
      'List designs: open tabs (addressable by designId) and recent files (open via open_design).',
    schema: {},
    handler: async () => {
      const { open, recent } = await rpc('designs.list', {})
      return json({ open, recent })
    }
  },
  {
    name: 'create_design',
    description:
      'Create a new design (opens as a tab the human sees). Pass width/height in px or a full design JSON. Returns the designId.',
    schema: {
      name: z.string().optional().describe('Tab name shown to the human'),
      width: z.number().optional().describe('Canvas width in px (default 1080)'),
      height: z.number().optional().describe('Canvas height in px (default 1080)'),
      json: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Full design JSON (store.toJSON() shape) to load instead of an empty canvas')
    },
    handler: async ({ name, width, height, json: designJson }: any) => {
      if (designJson) {
        const check = validateDesign(designJson)
        if (!check.valid) {
          throw new Error(`Invalid design JSON: ${JSON.stringify(check.errors?.slice(0, 5))}`)
        }
      }
      const result = unwrap(
        await rpc('app.exec', {
          command: { type: 'create_tab', name, width, height, json: designJson }
        })
      )
      return json(result.value)
    }
  },
  {
    name: 'open_design',
    description:
      'Focus an open tab by designId, or open a design file from disk by filePath. Returns the designId.',
    schema: {
      designId: z.string().optional(),
      filePath: z.string().optional().describe('Absolute path to a .polotno/.json design file')
    },
    handler: async ({ designId: id, filePath }: any) => {
      if (id) {
        unwrap(await rpc('app.exec', { command: { type: 'activate_tab', docId: id } }))
        return json({ designId: id })
      }
      if (filePath) {
        const result = unwrap(await rpc('app.exec', { command: { type: 'open_path', filePath } }))
        return json(result.value)
      }
      throw new Error('Pass designId or filePath')
    }
  },
  {
    name: 'save_design',
    description:
      'Save a design to its file. Pass filePath (absolute) to bind a file to an unsaved design.',
    schema: { designId, filePath: z.string().optional() },
    handler: async ({ designId: id, filePath }: any) => {
      const result = unwrap(
        await rpc('app.exec', { command: { type: 'save_tab', docId: id, filePath } })
      )
      return json(result.value)
    }
  },
  {
    name: 'get_design_info',
    description: 'Design metadata: size, dpi, pages with element counts, current rev.',
    schema: { designId },
    handler: async ({ designId: id }: any) => {
      const { value, rev } = await exec(id, { type: 'get_info' })
      return json({ ...(value as object), rev })
    }
  },
  {
    name: 'set_design_size',
    description:
      'Resize the canvas. magicResize scales all elements proportionally (adapt to a new format).',
    schema: {
      designId,
      width: z.number(),
      height: z.number(),
      magicResize: z.boolean().optional()
    },
    handler: async ({ designId: id, width, height, magicResize }: any) => {
      const { rev } = await exec(id, { type: 'set_size', width, height, magicResize })
      return json({ ok: true, rev })
    }
  },
  {
    name: 'add_page',
    description: 'Add a page at the end. Returns the new pageId.',
    schema: {
      designId,
      background: z.string().optional().describe('CSS color or image URL'),
      duration: z.number().optional().describe('Page duration in ms (for video designs)')
    },
    handler: async ({ designId: id, background, duration }: any) => {
      const { value, rev } = await exec(id, {
        type: 'add_page',
        background: await withAssets(id, background),
        duration
      })
      return json({ ...(value as object), rev })
    }
  },
  {
    name: 'remove_page',
    description: 'Remove a page.',
    schema: { designId, pageId: z.string() },
    handler: async ({ designId: id, pageId }: any) => {
      const { rev } = await exec(id, { type: 'remove_page', pageId })
      return json({ ok: true, rev })
    }
  },
  {
    name: 'move_page',
    description: 'Move a page to a new index (0-based).',
    schema: { designId, pageId: z.string(), toIndex: z.number() },
    handler: async ({ designId: id, pageId, toIndex }: any) => {
      const { rev } = await exec(id, { type: 'move_page', pageId, toIndex })
      return json({ ok: true, rev })
    }
  },
  {
    name: 'set_page',
    description: 'Set page properties (background color/image URL, duration, width/height, …).',
    schema: { designId, pageId: z.string(), props: z.record(z.string(), z.unknown()), check },
    handler: async ({ designId: id, pageId, props, check: wanted }: any) => {
      const resolved = await withAssets(id, props)
      const merged = await setSeen(id, 'page', pageId, resolved)
      if (merged?.skipped) {
        const { rev, skipped } = merged
        return checked(id, wanted, { ok: true, rev, skipped, note: KEPT_NOTE }, [pageId])
      }
      const rev = merged
        ? merged.rev
        : (await exec(id, { type: 'set_page', pageId, props: resolved })).rev
      return checked(id, wanted, { ok: true, rev }, [pageId])
    }
  },
  {
    name: 'add_element',
    description:
      'Add an element (type: text | image | svg | figure | line | video | group plus its properties). Later elements render on top. Returns the generated elementId.',
    schema: {
      designId,
      pageId: z.string().optional(),
      element: z
        .object({ type: z.enum(['text', 'image', 'svg', 'figure', 'line', 'video', 'group']) })
        .catchall(z.unknown()),
      atIndex: z.number().optional().describe('Z-order index to insert at'),
      check
    },
    handler: async ({ designId: id, pageId, element, atIndex, check: wanted }: any) => {
      const { value, rev } = await exec(id, {
        type: 'add_element',
        pageId,
        element: await checkedEdit(id, { add: element, pageId }),
        atIndex
      })
      const { elementId } = value as { elementId: string }
      return checked(id, wanted, { elementId, rev }, [elementId])
    }
  },
  {
    name: 'place_image',
    description:
      'Place a local image file (PNG, JPEG, WebP, GIF or SVG — e.g. one you just generated) on a page. The file is embedded in the design, so it can be deleted afterwards. Without width/height it keeps its aspect ratio and fits inside the page; without x/y it is centered. With as: "background" it becomes the page background instead (cover-fitted, not an element). Returns elementId plus the placed box.',
    schema: {
      designId,
      pageId: z.string().optional().describe('Defaults to the page the user is on'),
      filePath: z.string().describe('Absolute path to the image file'),
      as: z
        .enum(['element', 'background'])
        .optional()
        .describe('"background" sets the page background; default "element"'),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z
        .number()
        .positive()
        .optional()
        .describe('Omit to derive from height and aspect ratio'),
      height: z
        .number()
        .positive()
        .optional()
        .describe('Omit to derive from width and aspect ratio'),
      props: z
        .record(z.string(), z.unknown())
        .optional()
        .describe('Extra element properties, e.g. name, opacity, cornerRadius'),
      atIndex: z.number().optional().describe('Z-order index to insert at')
    },
    handler: async ({
      designId: id,
      pageId,
      filePath,
      as,
      x,
      y,
      width,
      height,
      props,
      atIndex
    }: any) => {
      const image = await readLocalImage(filePath)
      const info = (await exec(id, { type: 'get_info' })).value as {
        activePageId: string | null
        pages: { id: string; width: number; height: number }[]
      }
      const page = info.pages.find((p) => p.id === (pageId ?? info.activePageId))
      if (!page) throw new Error(`page_not_found: no page ${pageId}`)

      if (as === 'background') {
        const { rev } = await exec(id, {
          type: 'set_page',
          pageId: page.id,
          props: { background: image.dataUrl }
        })
        return json({ ok: true, pageId: page.id, background: true, rev })
      }

      const aspect = image.width / image.height
      if (width === undefined && height === undefined) {
        const scale = Math.min(1, page.width / image.width, page.height / image.height)
        width = image.width * scale
        height = image.height * scale
      } else {
        width ??= height * aspect
        height ??= width / aspect
      }
      x ??= (page.width - width) / 2
      y ??= (page.height - height) / 2
      const element = await checkedEdit(id, {
        add: { ...props, type: image.type, src: image.dataUrl, x, y, width, height },
        pageId: page.id
      })
      const { value, rev } = await exec(id, {
        type: 'add_element',
        pageId: page.id,
        element,
        atIndex
      })
      return json({ ...(value as object), pageId: page.id, x, y, width, height, rev })
    }
  },
  {
    name: 'update_element',
    description: 'Update properties of an element by id.',
    schema: {
      designId,
      elementId: z.string(),
      props: z.record(z.string(), z.unknown()),
      check
    },
    handler: async ({ designId: id, elementId, props, check: wanted }: any) => {
      const resolved = await checkedEdit(id, { update: props, elementId })
      const merged = await setSeen(id, 'element', elementId, resolved)
      if (merged?.skipped) {
        const { rev, skipped } = merged
        return checked(id, wanted, { ok: true, rev, skipped, note: KEPT_NOTE }, [elementId])
      }
      const rev = merged
        ? merged.rev
        : (await exec(id, { type: 'update_element', elementId, props: resolved })).rev
      return checked(id, wanted, { ok: true, rev }, [elementId])
    }
  },
  {
    name: 'remove_element',
    description: 'Remove elements by id.',
    schema: { designId, elementIds: z.array(z.string()), check },
    handler: async ({ designId: id, elementIds, check: wanted }: any) => {
      const before = wanted && ((await exec(id, { type: 'get_json' })).value as DesignJson)
      const pageId = before ? pageFor(before, elementIds[0]) : undefined
      const { rev } = await exec(id, { type: 'remove_elements', elementIds })
      return checked(id, wanted, { ok: true, rev }, [pageId])
    }
  },
  {
    name: 'move_element',
    description: 'Change element z-order: direction up/down/front/back, or an explicit toIndex.',
    schema: {
      designId,
      elementId: z.string(),
      direction: z.enum(['up', 'down', 'front', 'back']).optional(),
      toIndex: z.number().optional()
    },
    handler: async ({ designId: id, elementId, direction, toIndex }: any) => {
      const { rev } = await exec(id, { type: 'move_element', elementId, direction, toIndex })
      return json({ ok: true, rev })
    }
  },
  {
    name: 'get_design_json',
    description:
      'Design JSON (store.toJSON() shape) with the current rev. Use rev as baseRev when patching. Properties at their Polotno default are left out (an element without "opacity" has opacity 1); set them like any other, "add" or "replace" both work. Fractions are rounded to 2 decimals. A very large design comes back with only the current page in full and the others outlined. Embedded assets (long data: URLs) are shortened to "data-elided:<mime>;bytes=…;sha=…" references; keep or copy a reference as-is (in patches, add_element, update_element) and it resolves to the original asset.',
    schema: {
      designId,
      pages: z
        .array(z.union([z.number(), z.string()]))
        .optional()
        .describe(
          'Only these pages in full (index or page id); the others come as outlines. Omit for the whole design.'
        )
    },
    handler: async ({ designId: id, pages }: any) => {
      const { value, rev } = await exec(id, { type: 'get_json' })
      rememberRead(id, rev, value)
      const design = elideDataUrls(await compact(id, value))
      if (pages?.length) {
        const wanted = new Set<unknown>(pages)
        const isWanted = (pageId: string, index: number): boolean =>
          wanted.has(pageId) || wanted.has(index)
        let picked = outlineDesign(design, isWanted)
        if (JSON.stringify(picked).length > FULL_DESIGN_LIMIT) {
          picked = outlineDesign(design, isWanted, { brief: true })
        }
        if (pages.length > 1 && JSON.stringify(picked).length > FULL_DESIGN_LIMIT) {
          throw new Error(
            'too_large: these pages together are too large to read at once. Ask for fewer pages.'
          )
        }
        return json({ rev, json: picked, note: OUTLINE_NOTE })
      }
      if (JSON.stringify(design).length <= FULL_DESIGN_LIMIT) return json({ rev, json: design })
      // Too big for one tool result: the page the user is on in full, the
      // others outlined (or, for very many pages, only counted).
      const { value: info } = await exec(id, { type: 'get_info' })
      const active = (info as { activePageId: string | null }).activePageId
      const isActive = (pageId: string, index: number): boolean =>
        active ? pageId === active : index === 0
      let outlined = outlineDesign(design, isActive)
      if (JSON.stringify(outlined).length > FULL_DESIGN_LIMIT) {
        outlined = outlineDesign(design, isActive, { brief: true })
      }
      return json({
        rev,
        json: outlined,
        note: `This design is too large to read whole. ${OUTLINE_NOTE}`
      })
    }
  },
  {
    name: 'patch_design_json',
    description:
      'Apply an RFC 6902 JSON Patch — the escape hatch for bulk/structural edits. Pass the baseRev of the get_design_json you based the paths on: the patch applies to that copy, and only what it changes reaches the live design, so the user can keep editing meanwhile. Properties the user changed since your read keep their value and come back as "skipped". The result is schema-validated before it touches the design.',
    schema: {
      designId,
      patch: z.array(z.record(z.string(), z.unknown())).describe('RFC 6902 operations'),
      baseRev: z.number().optional(),
      check
    },
    handler: async ({ designId: id, patch, baseRev, check: wanted }: any) => {
      const current = await exec(id, { type: 'get_json' })
      const read = baseRev === undefined ? undefined : reads.get(id)?.get(baseRev)
      if (!read && baseRev !== undefined && current.rev !== undefined && baseRev !== current.rev) {
        throw new Error(
          `rev_conflict: design is at rev ${current.rev}, you based the patch on rev ${baseRev}. Re-read with get_design_json.`
        )
      }
      const base = (read ?? current.value) as any
      // Elision only rewrites leaf strings, so the agent's paths address the
      // full design unchanged; only references inside op values need restoring.
      const ops = restoreDataUrls(patch, base)
      let patched: any
      try {
        patched = applyPatch(
          structuredClone(base),
          ops as unknown as Operation[],
          true,
          false
        ).newDocument
      } catch (error) {
        // fast-json-patch's message embeds the whole document; name the
        // failing operation only.
        const { name, index, operation } = error as {
          name?: string
          index?: number
          operation?: unknown
        }
        throw new Error(
          name && operation
            ? `invalid_patch: ${name} at operation ${index}: ${JSON.stringify(operation)}. Paths address the design you read with get_design_json; re-read it if it changed.`
            : `invalid_patch: ${(error as Error).message}`
        )
      }
      const check = validateDesign(patched)
      if (!check.valid) {
        throw new Error(
          `invalid_result: the patched design fails schema validation: ${JSON.stringify(check.errors?.slice(0, 5))}`
        )
      }

      const diff = diffDesign(base, patched)
      if ('fallback' in diff) {
        // Loading the whole patched copy would undo anything changed since the
        // read, so it is only safe when nothing was.
        if (!isEqual(base, current.value)) {
          throw new Error(
            `rev_conflict: this patch can't be merged into a design that changed since your read (${diff.fallback}). Re-read with get_design_json and patch again.`
          )
        }
        const { rev } = await exec(id, { type: 'load_json', json: patched })
        rememberSeen(id, patched)
        return checked(id, wanted, { ok: true, rev })
      }
      const { value, rev } = await exec(id, { type: 'apply_changes', changes: diff.changes })
      const { skipped } = value as { skipped: unknown[] }
      // The agent now knows the design as it patched it.
      rememberSeen(id, patched)
      // The pages changed, for check.
      const targets = diff.changes.map((change) => {
        const { id: target, parentId } = change as { id?: string; parentId?: string }
        return target ?? parentId
      })
      return checked(
        id,
        wanted,
        skipped.length
          ? {
              ok: true,
              rev,
              skipped,
              note: KEPT_NOTE
            }
          : { ok: true, rev },
        targets
      )
    }
  },
  {
    name: 'render_page',
    description:
      'Render a page to an image — your eyes on the design. Use after edits. Clamped to maxSide (default 1024).',
    schema: {
      designId,
      pageId: z.string().optional(),
      maxSide: z.number().optional()
    },
    handler: async ({ designId: id, pageId, maxSide }: any) => {
      const { value } = await exec(id, { type: 'render', pageId, maxSide })
      const { dataUrl } = value as { dataUrl: string }
      return { kind: 'image', dataUrl }
    }
  },
  {
    name: 'export_design',
    description:
      'Export to files on disk (png/jpeg: one per page; pdf: single file). Returns paths. dir defaults to Downloads. Omit fileName and the design names itself from its own text.',
    schema: {
      designId,
      format: z
        .enum(['png', 'jpeg', 'pdf', 'pdf-flat'])
        .describe(
          'pdf keeps text selectable and must embed every font; pdf-flat rasterizes the pages and never fails on a font'
        ),
      pageId: z.string().optional().describe('Export one page instead of all of them'),
      pixelRatio: z
        .number()
        .optional()
        .describe('Scale for png, jpeg and pdf-flat; a vector pdf has no pixels to scale'),
      dir: z.string().optional().describe('Absolute directory to write into'),
      fileName: z.string().optional().describe('Base file name without extension')
    },
    handler: async ({ designId: id, format, pageId, pixelRatio, dir, fileName }: any) => {
      const { value } = await exec(id, { type: 'export', format, pageId, pixelRatio })
      const { pages, suggestedName } = value as {
        pages: { pageId?: string; dataUrl: string }[]
        suggestedName: string
      }
      const base = fileName ?? suggestedName
      const paths: string[] = []
      for (const [index, page] of pages.entries()) {
        const suffix = pages.length > 1 ? `-${index + 1}` : ''
        const ext = EXPORT_EXTENSIONS[format as ExportFormat]
        const { path } = await rpc('export.write', {
          fileName: `${base}${suffix}.${ext}`,
          base64: page.dataUrl.split(',')[1],
          dir
        })
        paths.push(path)
      }
      return json({ paths })
    }
  },
  {
    name: 'lint_design',
    description:
      'Design checks: text overflow, out-of-bounds, contrast, tiny text, overlaps, broken assets, missing fonts. Fix errors, then re-render.',
    schema: { designId, pageId: z.string().optional() },
    handler: async ({ designId: id, pageId }: any) => {
      const { value } = await exec(id, { type: 'lint', pageId })
      return json({ findings: value })
    }
  }
]
/* eslint-enable @typescript-eslint/no-explicit-any */

export function toCallToolResult(result: ToolResult): CallToolResult {
  if (result.kind === 'image') {
    const [meta, data] = result.dataUrl.split(',')
    const mimeType = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png'
    return { content: [{ type: 'image', data, mimeType }] }
  }
  const text = typeof result.value === 'string' ? result.value : JSON.stringify(result.value)
  if (!result.image) return { content: [{ type: 'text', text }] }
  const [meta, data] = result.image.split(',')
  const mimeType = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png'
  return {
    content: [
      { type: 'text', text },
      { type: 'image', data, mimeType }
    ]
  }
}

export function registerTools(server: McpServer): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: z.object(tool.schema) },
      async (args: Record<string, never>) => toCallToolResult(await tool.handler(args))
    )
  }
}
