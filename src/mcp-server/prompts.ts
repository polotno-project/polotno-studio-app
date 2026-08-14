import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

// User-facing MCP prompts. `setup` is the first-run flow — deliberately a
// setup check that ends in one design, not a product tour. `design-skill`
// inlines the bundled skill so any client can load it deterministically.

const SETUP = `You are connected to the Polotno desktop app.

1. Call list_designs to confirm the connection works. Tell the user in one
   line that Polotno is connected.
2. Say in one sentence what you can do: create, edit, and export designs
   live in their editor — they see every change and can edit alongside you.
3. Ask them one question: "What should I make first?" Then build that one
   design following the skill (resource polotno://skill/SKILL.md): archetype,
   render_page to look, lint_design, iterate until it passes.

Keep the whole flow short. No feature tours, no menus, no jargon.`

function prompt(text: string): { messages: { role: 'user'; content: { type: 'text'; text: string } }[] } {
  return { messages: [{ role: 'user', content: { type: 'text', text } }] }
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'setup',
    { description: 'First run: verify the connection and make one design together' },
    () => prompt(SETUP)
  )

  const skillDir = process.env.POLOTNO_SKILLS_DIR
  if (!skillDir) return
  server.registerPrompt(
    'design-skill',
    { description: 'Load the Polotno design skill (rules, workflows, rubric) into context' },
    () => {
      const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
      const runtime = readFileSync(join(skillDir, 'reference/runtimes/local-app.md'), 'utf8')
      return prompt(
        `Loaded the polotno-design skill. Apply it to the current task. You are in the "Polotno desktop app" runtime.\n\n${skill}\n\n---\n\n${runtime}`
      )
    }
  )
}
