import { _electron as electron } from 'playwright-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const userData = path.join(os.homedir(), 'Library/Application Support/polotno-app')
const draftsDir = path.join(userData, 'drafts')
fs.rmSync(draftsDir, { recursive: true, force: true })

const launch = () => electron.launch({
  executablePath: './node_modules/electron/dist/Electron.app/Contents/MacOS/Electron',
  args: ['.'], timeout: 30000
})

// Session 1: edit untitled tab, wait for autosave draft, quit (flush).
let app = await launch()
let page = await app.firstWindow()
await page.waitForFunction(() => !!window.polotnoApp, { timeout: 20000 })
await page.waitForTimeout(1000)
await page.evaluate(() => {
  const t = window.polotnoApp.tabs.active
  t.store.activePage.addElement({ type: 'text', text: 'draft survives', x: 10, y: 10, width: 200 })
})
await page.waitForTimeout(2500)  // 400ms dirty + 1000ms autosave + margin
const drafts1 = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir) : []
console.log('drafts after edit:', drafts1.length)
const dirty = await page.evaluate(() => window.polotnoApp.tabs.active.dirty)
console.log('tab dirty flag:', dirty)
await app.close()

// Session 2: draft should be restored.
app = await launch()
page = await app.firstWindow()
await page.waitForFunction(() => !!window.polotnoApp, { timeout: 20000 })
await page.waitForTimeout(2000)
const restored = await page.evaluate(() => {
  const t = window.polotnoApp.tabs.tabs[0]
  return { count: window.polotnoApp.tabs.tabs.length, texts: t.store.toJSON().pages[0].children.map(c => c.text), hasDraft: t.hasDraft }
})
console.log('restored:', JSON.stringify(restored))
const drafts2 = fs.readdirSync(draftsDir)
console.log('drafts after restore:', drafts2.length)
await app.close()
