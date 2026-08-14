// Builds the Claude Desktop bundle: esbuild the stdio proxy, zip it with the
// manifest into out/Polotno.mcpb (shipped in app resources so the Connect
// panel can save it without a network call).
import { build } from 'esbuild'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(ROOT, 'mcpb/server/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(ROOT, 'out/mcpb-server.cjs'),
  logLevel: 'warning'
})

const zip = new JSZip()
zip.file('manifest.json', await fs.readFile(path.join(ROOT, 'mcpb/manifest.json')))
zip.file('server/index.js', await fs.readFile(path.join(ROOT, 'out/mcpb-server.cjs')))
const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
await fs.writeFile(path.join(ROOT, 'out/Polotno.mcpb'), content)
console.log('out/Polotno.mcpb', content.length, 'bytes')
