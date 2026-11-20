// Bundle editor-app.js into .editor/editor.js for serve.js. The server runs
// this file when the bundle is missing or stale.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { ensureDependencies } = require('./dependencies')
const dependencyFingerprint = ensureDependencies()
const { build } = await import('esbuild')
const editorDirectory = path.join(dir, '.editor')

fs.mkdirSync(editorDirectory, { recursive: true })

await build({
  entryPoints: [path.join(dir, 'editor-app.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(editorDirectory, 'editor.js'),
  minify: true,
  logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"' }
})
fs.writeFileSync(
  path.join(editorDirectory, 'dependencies.json'),
  `${dependencyFingerprint}\n`
)
console.log('built .editor/editor.js')
