// Bundles the MCP utilityProcess server to a single CJS file. utilityProcess
// needs a real file (not asar-internal module resolution), so the bundle ships
// via electron-builder extraResources.
import { build } from 'esbuild'

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
