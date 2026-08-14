// Bundles the MCP utilityProcess server to a single CJS file. utilityProcess
// needs a real file (not asar-internal module resolution), so the bundle ships
// via electron-builder extraResources.
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

// Clients truncate long MCP instructions silently — a rule that gets cut off
// stops existing. Keep the string pointer-shaped and under budget.
const INSTRUCTIONS_BUDGET = 4096
const source = readFileSync('src/mcp-server/index.ts', 'utf8')
const match = /const INSTRUCTIONS = `([\s\S]*?)`/.exec(source)
if (!match) {
  console.error('build-mcp-server: INSTRUCTIONS template literal not found')
  process.exit(1)
}
if (match[1].length > INSTRUCTIONS_BUDGET) {
  console.error(
    `build-mcp-server: INSTRUCTIONS is ${match[1].length} chars — budget is ${INSTRUCTIONS_BUDGET}`
  )
  process.exit(1)
}

await build({
  entryPoints: ['src/mcp-server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'out/mcp-server.cjs',
  sourcemap: false,
  logLevel: 'info'
})
