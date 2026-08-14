// Renders preview JPEGs for the bundled template pack by driving the built
// app (hidden window) — the same store renders the previews that will render
// the designs. Run after adding/changing templates:
//   npm run build && node scripts/build-template-previews.mjs
// Output (src/renderer/public/templates/*.jpg) is committed.
import { _electron as electron } from 'playwright-core'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TEMPLATES_DIR = path.join(ROOT, 'src/renderer/src/templates')
const PREVIEWS_DIR = path.join(ROOT, 'src/renderer/public/templates')
const PREVIEW_WIDTH = 300

const app = await electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
  args: [ROOT],
  timeout: 30000,
  env: { ...process.env, POLOTNO_SHOW_INACTIVE: '1' }
})
const page = await app.firstWindow()
await page.waitForFunction(() => !!window.polotnoApp?.tabs?.active, { timeout: 30000 })

await fs.mkdir(PREVIEWS_DIR, { recursive: true })
for (const file of await fs.readdir(TEMPLATES_DIR)) {
  if (!file.endsWith('.json')) continue
  const json = JSON.parse(await fs.readFile(path.join(TEMPLATES_DIR, file), 'utf8'))
  const dataUrl = await page.evaluate(
    async ({ json, width }) => {
      const store = window.polotnoApp.tabs.active.store
      store.loadJSON(json)
      await store.waitLoading()
      return store.toDataURL({
        mimeType: 'image/jpeg',
        pixelRatio: width / store.width,
        quality: 0.85
      })
    },
    { json, width: PREVIEW_WIDTH }
  )
  const out = path.join(PREVIEWS_DIR, file.replace(/\.json$/, '.jpg'))
  await fs.writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('preview:', path.relative(ROOT, out))
}
await app.evaluate(({ app }) => app.exit(0))
process.exit(0)
