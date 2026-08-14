import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { applyPatch, type Operation } from 'fast-json-patch'
import { validateDesign } from '@polotno/schema'
import { rpc } from './bridge-client'
import type { CommandResult, DesignCommand } from '../shared/commands'

// The agent-facing tool surface. Typed tools for targeted edits, raw JSON
// get/patch as the universal escape hatch, render + lint as the agent's eyes.

function text(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
  }
}

function unwrap(result: CommandResult): { value: unknown; rev?: number } {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return { value: result.value, rev: result.rev }
}

async function exec(designId: string, command: DesignCommand): Promise<{ value: unknown; rev?: number }> {
  return unwrap(await rpc('design.exec', { docId: designId, command }))
}

const designId = z.string().describe('The design id (from list_designs or create_design)')

export function registerTools(server: McpServer): void {
  server.registerTool(
    'list_designs',
    {
      description:
        'List designs: open tabs in the editor (addressable by designId) and recently opened files (open them with open_design by filePath).',
      inputSchema: {}
    },
    async () => {
      const { open, recent } = await rpc('designs.list', {})
      return text({ open, recent })
    }
  )

  server.registerTool(
    'create_design',
    {
      description:
        'Create a new design. It opens as a background tab the human can see immediately. Pass width/height (px) or a full design JSON. Returns the designId for follow-up edits.',
      inputSchema: {
        name: z.string().optional().describe('Tab name shown to the human'),
        width: z.number().optional().describe('Canvas width in px (default 1080)'),
        height: z.number().optional().describe('Canvas height in px (default 1080)'),
        json: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Full design JSON (store.toJSON() shape) to load instead of an empty canvas')
      }
    },
    async ({ name, width, height, json }) => {
      if (json) {
        const check = validateDesign(json)
        if (!check.valid) {
          throw new Error(`Invalid design JSON: ${JSON.stringify(check.errors?.slice(0, 5))}`)
        }
      }
      const result = unwrap(
        await rpc('app.exec', { command: { type: 'create_tab', name, width, height, json } })
      )
      return text(result.value)
    }
  )

  server.registerTool(
    'open_design',
    {
      description:
        'Open a design: focus an open tab by designId, or open a design file from disk by filePath. Returns the designId.',
      inputSchema: {
        designId: z.string().optional(),
        filePath: z.string().optional().describe('Absolute path to a .polotno/.json design file')
      }
    },
    async ({ designId: id, filePath }) => {
      if (id) {
        unwrap(await rpc('app.exec', { command: { type: 'activate_tab', docId: id } }))
        return text({ designId: id })
      }
      if (filePath) {
        const result = unwrap(await rpc('app.exec', { command: { type: 'open_path', filePath } }))
        return text(result.value)
      }
      throw new Error('Pass designId or filePath')
    }
  )

  server.registerTool(
    'save_design',
    {
      description:
        'Save a design to its file. For a design without a file yet, pass filePath (absolute, .polotno) to bind one; otherwise it keeps living as an autosaved draft.',
      inputSchema: { designId, filePath: z.string().optional() }
    },
    async ({ designId: id, filePath }) => {
      const result = unwrap(
        await rpc('app.exec', { command: { type: 'save_tab', docId: id, filePath } })
      )
      return text(result.value)
    }
  )

  server.registerTool(
    'get_design_info',
    {
      description: 'Get design metadata: size, dpi, pages with element counts, and the current rev.',
      inputSchema: { designId }
    },
    async ({ designId: id }) => {
      const { value, rev } = await exec(id, { type: 'get_info' })
      return text({ ...(value as object), rev })
    }
  )

  server.registerTool(
    'set_design_size',
    {
      description:
        'Resize the design canvas. magicResize scales all elements proportionally (use it to adapt a design to a new format).',
      inputSchema: {
        designId,
        width: z.number(),
        height: z.number(),
        magicResize: z.boolean().optional()
      }
    },
    async ({ designId: id, width, height, magicResize }) => {
      const { rev } = await exec(id, { type: 'set_size', width, height, magicResize })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'add_page',
    {
      description: 'Add a page at the end of the design. Returns the new pageId.',
      inputSchema: {
        designId,
        background: z.string().optional().describe('CSS color or image URL'),
        duration: z.number().optional().describe('Page duration in ms (for video designs)')
      }
    },
    async ({ designId: id, background, duration }) => {
      const { value, rev } = await exec(id, { type: 'add_page', background, duration })
      return text({ ...(value as object), rev })
    }
  )

  server.registerTool(
    'remove_page',
    { description: 'Remove a page.', inputSchema: { designId, pageId: z.string() } },
    async ({ designId: id, pageId }) => {
      const { rev } = await exec(id, { type: 'remove_page', pageId })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'move_page',
    {
      description: 'Move a page to a new index (0-based).',
      inputSchema: { designId, pageId: z.string(), toIndex: z.number() }
    },
    async ({ designId: id, pageId, toIndex }) => {
      const { rev } = await exec(id, { type: 'move_page', pageId, toIndex })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'set_page',
    {
      description:
        'Set page properties (background color/image URL, duration, custom width/height, …).',
      inputSchema: { designId, pageId: z.string(), props: z.record(z.string(), z.unknown()) }
    },
    async ({ designId: id, pageId, props }) => {
      const { rev } = await exec(id, { type: 'set_page', pageId, props })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'add_element',
    {
      description:
        'Add an element to a page (active page if pageId omitted). element must include type: text | image | svg | figure | line | video | group plus its properties (x, y, width, height, text, fontSize, src, fill, …). Later elements render on top. Returns the generated elementId.',
      inputSchema: {
        designId,
        pageId: z.string().optional(),
        element: z
          .object({ type: z.enum(['text', 'image', 'svg', 'figure', 'line', 'video', 'group']) })
          .catchall(z.unknown()),
        atIndex: z.number().optional().describe('Z-order index to insert at')
      }
    },
    async ({ designId: id, pageId, element, atIndex }) => {
      const { value, rev } = await exec(id, { type: 'add_element', pageId, element, atIndex })
      return text({ ...(value as object), rev })
    }
  )

  server.registerTool(
    'update_element',
    {
      description:
        'Update properties of an element by id (position, size, text, colors, fontSize, src, …).',
      inputSchema: { designId, elementId: z.string(), props: z.record(z.string(), z.unknown()) }
    },
    async ({ designId: id, elementId, props }) => {
      const { rev } = await exec(id, { type: 'update_element', elementId, props })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'remove_element',
    {
      description: 'Remove elements by id.',
      inputSchema: { designId, elementIds: z.array(z.string()) }
    },
    async ({ designId: id, elementIds }) => {
      const { rev } = await exec(id, { type: 'remove_elements', elementIds })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'move_element',
    {
      description: 'Change element z-order: direction up/down/front/back, or an explicit toIndex.',
      inputSchema: {
        designId,
        elementId: z.string(),
        direction: z.enum(['up', 'down', 'front', 'back']).optional(),
        toIndex: z.number().optional()
      }
    },
    async ({ designId: id, elementId, direction, toIndex }) => {
      const { rev } = await exec(id, { type: 'move_element', elementId, direction, toIndex })
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'get_design_json',
    {
      description:
        'Get the full design JSON (store.toJSON() shape) with the current rev. Use rev as baseRev for patch_design_json.',
      inputSchema: { designId }
    },
    async ({ designId: id }) => {
      const { value, rev } = await exec(id, { type: 'get_json' })
      return text({ rev, json: value })
    }
  )

  server.registerTool(
    'patch_design_json',
    {
      description:
        'Apply an RFC 6902 JSON Patch to the design JSON — the escape hatch for bulk/structural edits. Pass baseRev (from get_design_json) for optimistic concurrency. The patched document is schema-validated before it touches the design.',
      inputSchema: {
        designId,
        patch: z.array(z.record(z.string(), z.unknown())).describe('RFC 6902 operations'),
        baseRev: z.number().optional()
      }
    },
    async ({ designId: id, patch, baseRev }) => {
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
      return text({ ok: true, rev })
    }
  )

  server.registerTool(
    'render_page',
    {
      description:
        'Render a page to an image — your eyes on the design. Use after edits to check the visual result. Clamped to maxSide (default 1024).',
      inputSchema: {
        designId,
        pageId: z.string().optional(),
        maxSide: z.number().optional()
      }
    },
    async ({ designId: id, pageId, maxSide }) => {
      const { value } = await exec(id, { type: 'render', pageId, maxSide })
      const { dataUrl } = value as { dataUrl: string }
      const [meta, data] = dataUrl.split(',')
      const mimeType = /data:([^;]+)/.exec(meta)?.[1] ?? 'image/png'
      return { content: [{ type: 'image', data, mimeType }] }
    }
  )

  server.registerTool(
    'export_design',
    {
      description:
        'Export the design to files on disk (png/jpeg: one file per page; pdf: single file). Returns the written paths. dir defaults to the Downloads folder.',
      inputSchema: {
        designId,
        format: z.enum(['png', 'jpeg', 'pdf']),
        pageId: z.string().optional(),
        pixelRatio: z.number().optional(),
        dir: z.string().optional().describe('Absolute directory to write into'),
        fileName: z.string().optional().describe('Base file name without extension')
      }
    },
    async ({ designId: id, format, pageId, pixelRatio, dir, fileName }) => {
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
      return text({ paths })
    }
  )

  server.registerTool(
    'lint_design',
    {
      description:
        'Run design checks (text overflow, out-of-bounds, contrast, tiny text, overlapping text, broken assets, missing fonts). Fix errors, consider warnings, then re-render.',
      inputSchema: { designId, pageId: z.string().optional() }
    },
    async ({ designId: id, pageId }) => {
      const { value } = await exec(id, { type: 'lint', pageId })
      return text({ findings: value })
    }
  )
}
