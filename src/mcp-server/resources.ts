import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// Serves the bundled polotno-design skill (markdown only) as MCP resources
// under polotno://skill/… so any connected agent can read the design
// methodology without a separate skill install.

function markdownFiles(dir: string, base: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...markdownFiles(full, base))
    else if (entry.name.endsWith('.md')) files.push(relative(base, full))
  }
  return files
}

export function registerResources(server: McpServer): void {
  const skillDir = process.env.POLOTNO_SKILLS_DIR
  if (!skillDir) return
  let files: string[]
  try {
    files = markdownFiles(skillDir, skillDir)
  } catch (error) {
    console.error('Skill resources unavailable:', error)
    return
  }
  for (const file of files) {
    server.registerResource(
      file,
      `polotno://skill/${file}`,
      {
        title: file,
        description:
          file === 'SKILL.md'
            ? 'How to design well with Polotno — read this first.'
            : `polotno-design skill: ${file}`,
        mimeType: 'text/markdown'
      },
      (uri) => ({
        contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readFileSync(join(skillDir, file), 'utf8') }]
      })
    )
  }
}
