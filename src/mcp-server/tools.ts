import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { applyPatch, type Operation } from 'fast-json-patch'
import { validateDesign } from '@polotno/schema'
import { rpc } from './bridge-client'
import type { CommandResult, DesignCommand } from '../shared/commands'

// The agent-facing tool surface, defined once as a transport-neutral registry:
// MCP registration and the plain-HTTP dispatcher in index.ts both consume it.
// Typed tools for targeted edits, raw JSON get/patch as the universal escape
// hatch, render + lint as the agent's eyes.

export type ToolResult = { kind: 'json'; value: unknown } | { kind: 'image'; dataUrl: string }

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

const designId = z.string().describe('The design id (from list_designs or create_design)')

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
      const { value, rev } = await exec(id, { type: 'add_page', background, duration })
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
    schema: { designId, pageId: z.string(), props: z.record(z.string(), z.unknown()) },
    handler: async ({ designId: id, pageId, props }: any) => {
      const { rev } = await exec(id, { type: 'set_page', pageId, props })
      return json({ ok: true, rev })
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
      atIndex: z.number().optional().describe('Z-order index to insert at')
    },
    handler: async ({ designId: id, pageId, element, atIndex }: any) => {
      const { value, rev } = await exec(id, { type: 'add_element', pageId, element, atIndex })
      return json({ ...(value as object), rev })
    }
  },
  {
    name: 'update_element',
    description: 'Update properties of an element by id.',
    schema: { designId, elementId: z.string(), props: z.record(z.string(), z.unknown()) },
    handler: async ({ designId: id, elementId, props }: any) => {
      const { rev } = await exec(id, { type: 'update_element', elementId, props })
      return json({ ok: true, rev })
    }
  },
  {
    name: 'remove_element',
    description: 'Remove elements by id.',
    schema: { designId, elementIds: z.array(z.string()) },
    handler: async ({ designId: id, elementIds }: any) => {
      const { rev } = await exec(id, { type: 'remove_elements', elementIds })
      return json({ ok: true, rev })
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
      'Full design JSON (store.toJSON() shape) with the current rev. Use rev as baseRev when patching.',
    schema: { designId },
    handler: async ({ designId: id }: any) => {
      const { value, rev } = await exec(id, { type: 'get_json' })
      return json({ rev, json: value })
    }
  },
  {
    name: 'patch_design_json',
    description:
      'Apply an RFC 6902 JSON Patch — the escape hatch for bulk/structural edits. Pass baseRev for optimistic concurrency; the result is schema-validated before it touches the design.',
    schema: {
      designId,
      patch: z.array(z.record(z.string(), z.unknown())).describe('RFC 6902 operations'),
      baseRev: z.number().optional()
    },
    handler: async ({ designId: id, patch, baseRev }: any) => {
      const current = await exec(id, { type: 'get_json' })
      if (baseRev !== undefined && current.rev !== undefined && baseRev !== current.rev) {
        throw new Error(
          `rev_conflict: design is at rev ${current.rev}, you based the patch on rev ${baseRev}. Re-read with get_design_json.`
        )
      }
      let patched: unknown
      try {
        patched = applyPatch(
          structuredClone(current.value),
          patch as unknown as Operation[],
          true,
          false
        ).newDocument
      } catch (error) {
        throw new Error(`invalid_patch: ${String(error)}`)
      }
      const check = validateDesign(patched)
      if (!check.valid) {
        throw new Error(
          `invalid_result: the patched design fails schema validation: ${JSON.stringify(check.errors?.slice(0, 5))}`
        )
      }
      const { rev } = await exec(id, { type: 'load_json', json: patched })
      return json({ ok: true, rev })
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
      'Export to files on disk (png/jpeg: one per page; pdf: single file). Returns paths. dir defaults to Downloads.',
    schema: {
      designId,
      format: z.enum(['png', 'jpeg', 'pdf']),
      pageId: z.string().optional(),
      pixelRatio: z.number().optional(),
      dir: z.string().optional().describe('Absolute directory to write into'),
      fileName: z.string().optional().describe('Base file name without extension')
    },
    handler: async ({ designId: id, format, pageId, pixelRatio, dir, fileName }: any) => {
      const { value } = await exec(id, { type: 'export', format, pageId, pixelRatio })
      const { pages } = value as { pages: { pageId?: string; dataUrl: string }[] }
      const base = fileName ?? 'design'
      const paths: string[] = []
      for (const [index, page] of pages.entries()) {
        const suffix = pages.length > 1 ? `-${index + 1}` : ''
        const ext = format === 'jpeg' ? 'jpg' : format
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
  return {
    content: [
      {
        type: 'text',
        text: typeof result.value === 'string' ? result.value : JSON.stringify(result.value)
      }
    ]
  }
}

export function registerTools(server: McpServer): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, never>) => toCallToolResult(await tool.handler(args))
    )
  }
}
