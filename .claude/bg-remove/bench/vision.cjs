// Apple Vision (the app's Swift helper) on the bench images, for quality comparison on macOS 14+.
// `BENCH_ORDER=… BENCH_OUT=out-unsplash electron vision.cjs` → <BENCH_OUT>/vision/{name}.png/.alpha + result.json
const { app, nativeImage } = require('electron')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = __dirname
const HELPER = process.env.HELPER || path.join(ROOT, '../../../out/helpers/remove-background')
const IMAGES = process.env.BENCH_ORDER ? process.env.BENCH_ORDER.split(',') : ['portrait', 'dog', 'product', 'busy']
const outDir = path.join(ROOT, process.env.BENCH_OUT || 'out', 'vision')

app.whenReady().then(() => {
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  const result = { kind: 'vision', images: {} }
  for (const name of IMAGES) {
    const input = fs.readFileSync(path.join(ROOT, 'images', name + '.jpg'))
    const t = performance.now()
    const r = spawnSync(HELPER, [], { input, maxBuffer: 1 << 28 })
    const wallMs = performance.now() - t
    const visionMs = Number((r.stderr.toString().match(/(\d+(?:\.\d+)?) ?ms/) ?? [])[1]) || null
    const src = nativeImage.createFromBuffer(input).getSize()
    if (r.status !== 0) {
      // no subject (exit 3): an empty mask
      fs.writeFileSync(path.join(outDir, name + '.alpha'), Buffer.alloc(src.width * src.height))
      result.images[name] = { runMs: visionMs ?? wallMs, wallMs, exit: r.status }
      continue
    }
    fs.writeFileSync(path.join(outDir, name + '.png'), r.stdout)
    const img = nativeImage.createFromBuffer(r.stdout)
    const { width, height } = img.getSize()
    if (width !== src.width || height !== src.height) throw new Error(`${name}: size ${width}x${height}`)
    const bgra = img.toBitmap()
    const alpha = Buffer.alloc(width * height)
    for (let i = 0; i < alpha.length; i++) alpha[i] = bgra[i * 4 + 3]
    fs.writeFileSync(path.join(outDir, name + '.alpha'), alpha)
    result.images[name] = { runMs: visionMs ?? wallMs, wallMs, exit: 0 }
  }
  result.versions = { electron: process.versions.electron }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2))
  console.log('[vision] done', Object.keys(result.images).length)
  app.exit(0)
})
