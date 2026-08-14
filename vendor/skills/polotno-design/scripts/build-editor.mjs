// Bundles editor-app.js into .editor/editor.js for serve.js. Run by serve.js
// automatically when the bundle is missing or older than the source.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [path.join(dir, 'editor-app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(dir, '.editor/editor.js'),
  minify: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' }
})
console.log('built .editor/editor.js')
