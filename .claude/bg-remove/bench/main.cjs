// BiRefNet_lite benchmark — Electron main. One case per process: `electron main.cjs <caseId>`.
// Renderer cases run in a Web Worker inside a throwaway BrowserWindow served from a
// cross-origin-isolated custom protocol; node-* cases run onnxruntime-node in this process.
const { app, BrowserWindow, protocol, ipcMain, nativeImage } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = __dirname
const IMAGES = process.env.BENCH_ORDER ? process.env.BENCH_ORDER.split(',') : ['portrait', 'dog', 'product', 'busy']
const WARM_RUNS = 5
const MODELS = {
  fp16: 'models/model_fp16.onnx',
  fp32: 'models/model.onnx',
  patched: 'models/birefnet_lite_webgpu_fp16.onnx',
  patched32: 'models/birefnet_lite_webgpu_fp32.onnx',
  mixed16: 'models/birefnet_lite_webgpu_fp16mixed.onnx',
  chunked32: 'models/birefnet_lite_webgpu_fp32_chunked.onnx',
  chunked16: 'models/birefnet_lite_webgpu_fp16mixed_chunked.onnx'
}
const BUNDLES = {
  native: 'node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs', // native C++ WebGPU EP (asyncify wasm)
  jsep: 'node_modules/onnxruntime-web/dist/ort.all.min.mjs', // JSEP WebGPU EP
  wasm: 'node_modules/onnxruntime-web/dist/ort.wasm.min.mjs'
}

function caseConfig(id) {
  let m
  if ((m = id.match(/^ort-webgpu-(native|jsep)-(fp16|fp32|patched|patched32|mixed16|chunked32|chunked16)$/)))
    return { id, kind: 'ort', bundle: BUNDLES[m[1]], ep: 'webgpu', model: MODELS[m[2]] }
  if ((m = id.match(/^ort-wasm-(fp16|fp32|patched|patched32|mixed16|chunked32|chunked16)$/)))
    return { id, kind: 'ort', bundle: BUNDLES.wasm, ep: 'wasm', model: MODELS[m[1]] }
  if ((m = id.match(/^tfjs-(webgpu|wasm)-(fp16|fp32)$/)))
    return { id, kind: 'tfjs', device: m[1], dtype: m[2] }
  if ((m = id.match(/^node-(dml|cpu|webgpu)-(fp16|fp32|patched|patched32|mixed16|chunked32|chunked16)$/)))
    return { id, kind: 'node', ep: m[1], model: MODELS[m[2]] }
  throw new Error('unknown case ' + id)
}

const caseId = process.argv.find((a) => /^(ort|tfjs|node)-/.test(a))
const cfg = caseConfig(caseId)
const outDir = path.join(ROOT, process.env.BENCH_OUT || 'out', caseId)
fs.mkdirSync(outDir, { recursive: true })
const log = (...a) => console.log(`[${caseId}]`, ...a)

// ---------- memory sampling ----------
const mem = { rendererPeakMB: 0, gpuProcPeakMB: 0, browserPeakMB: 0, vramBaseMB: null, vramPeakMB: 0 }
let rendererPid = null
let benchWin = null
function sampleMetrics() {
  if (benchWin && !benchWin.isDestroyed()) rendererPid = benchWin.webContents.getOSProcessId() || rendererPid
  for (const p of app.getAppMetrics()) {
    const mb = (p.memory.privateBytes ?? p.memory.workingSetSize) / 1024
    if (p.type === 'GPU') mem.gpuProcPeakMB = Math.max(mem.gpuProcPeakMB, mb)
    if (p.type === 'Browser') mem.browserPeakMB = Math.max(mem.browserPeakMB, mb)
    if (rendererPid && p.pid === rendererPid) mem.rendererPeakMB = Math.max(mem.rendererPeakMB, mb)
  }
}
function sampleVram() {
  execFile('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], (err, out) => {
    if (err) return
    const v = parseInt(out, 10)
    if (mem.vramBaseMB === null) mem.vramBaseMB = v
    mem.vramPeakMB = Math.max(mem.vramPeakMB, v)
  })
}
const metricsTimer = setInterval(sampleMetrics, 100)
const vramTimer = setInterval(sampleVram, 250)

function finish(result) {
  sampleMetrics()
  clearInterval(metricsTimer)
  clearInterval(vramTimer)
  const r = (x) => Math.round(x)
  result.memory = {
    rendererPrivatePeakMB: r(mem.rendererPeakMB),
    gpuProcessPrivatePeakMB: r(mem.gpuProcPeakMB),
    mainProcessPrivatePeakMB: r(mem.browserPeakMB),
    vramDeltaPeakMB: mem.vramBaseMB === null ? null : r(mem.vramPeakMB - mem.vramBaseMB)
  }
  result.case = { ...cfg, ...(process.env.BENCH_SESSION ? JSON.parse(process.env.BENCH_SESSION) : {}) }
  result.versions = { electron: process.versions.electron, chrome: process.versions.chrome }
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2))
  log('done', JSON.stringify(result.summary ?? result.error))
  setTimeout(() => app.exit(0), 200)
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ---------- node (main-process) cases ----------
async function runNodeCase() {
  const ort = require('onnxruntime-node')
  ort.env.logLevel = 'error'
  const result = { images: {} }
  const t0 = performance.now()
  const session = await ort.InferenceSession.create(path.join(ROOT, cfg.model), {
    executionProviders: [cfg.ep === 'dml' ? 'dml' : cfg.ep, 'cpu'].filter((v, i, a) => a.indexOf(v) === i),
    logSeverityLevel: 3
  })
  result.loadMs = performance.now() - t0
  const prep = (name) => {
    const img = nativeImage.createFromPath(path.join(ROOT, 'images', name + '.jpg'))
    const { width, height } = img.getSize()
    const bgra = img.resize({ width: 1024, height: 1024, quality: 'best' }).toBitmap()
    const N = 1024 * 1024
    const chw = new Float32Array(3 * N)
    const mean = [0.485, 0.456, 0.406]
    const std = [0.229, 0.224, 0.225]
    for (let i = 0; i < N; i++) {
      chw[i] = (bgra[i * 4 + 2] / 255 - mean[0]) / std[0]
      chw[N + i] = (bgra[i * 4 + 1] / 255 - mean[1]) / std[1]
      chw[2 * N + i] = (bgra[i * 4] / 255 - mean[2]) / std[2]
    }
    return { img, width, height, tensor: new ort.Tensor('float32', chw, [1, 3, 1024, 1024]) }
  }
  const post = (name, p, logits) => {
    const N = 1024 * 1024
    const m = Buffer.alloc(N * 4)
    for (let i = 0; i < N; i++) {
      const a = Math.round(255 / (1 + Math.exp(-logits[i])))
      m[i * 4] = m[i * 4 + 1] = m[i * 4 + 2] = a
      m[i * 4 + 3] = 255
    }
    const maskImg = nativeImage
      .createFromBitmap(m, { width: 1024, height: 1024 })
      .resize({ width: p.width, height: p.height, quality: 'best' })
    const mb = maskImg.toBitmap()
    const src = p.img.toBitmap()
    const alpha = Buffer.alloc(p.width * p.height)
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = mb[i * 4 + 1]
      // premultiplied BGRA for nativeImage
      const a = alpha[i] / 255
      src[i * 4] = Math.round(src[i * 4] * a)
      src[i * 4 + 1] = Math.round(src[i * 4 + 1] * a)
      src[i * 4 + 2] = Math.round(src[i * 4 + 2] * a)
      src[i * 4 + 3] = alpha[i]
    }
    fs.writeFileSync(path.join(outDir, name + '.alpha'), alpha)
    fs.writeFileSync(
      path.join(outDir, name + '.png'),
      nativeImage.createFromBitmap(src, { width: p.width, height: p.height }).toPNG()
    )
  }
  for (const [idx, name] of IMAGES.entries()) {
    const p = prep(name)
    const t = performance.now()
    const out = await session.run({ input_image: p.tensor })
    const runMs = performance.now() - t
    post(name, p, out.output_image.data)
    result.images[name] = { runMs }
    if (idx === 0) {
      result.firstInferMs = runMs
      const warm = []
      for (let i = 0; i < WARM_RUNS; i++) {
        const t1 = performance.now()
        await session.run({ input_image: p.tensor })
        warm.push(performance.now() - t1)
      }
      result.warmRunsMs = warm
      result.warmMedianMs = median(warm)
    }
  }
  result.summary = { loadMs: result.loadMs, firstInferMs: result.firstInferMs, warmMedianMs: result.warmMedianMs }
  return result
}

// ---------- renderer cases ----------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'bench',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
])
const TYPES = {
  '.html': 'text/html',
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.onnx': 'application/octet-stream'
}

function runRendererCase() {
  protocol.handle('bench', async (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '')
    const file = path.join(ROOT, rel)
    const headers = {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream'
    }
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      return new Response('not found', { status: 404, headers })
    return new Response(fs.readFileSync(file), { headers })
  })
  ipcMain.handle('save', (_e, name, bytes) => fs.writeFileSync(path.join(outDir, name), Buffer.from(bytes)))
  ipcMain.on('log', (_e, msg) => log(msg))
  ipcMain.on('done', (_e, result) => finish(result))
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.cjs'), backgroundThrottling: false }
  })
  benchWin = win
  win.webContents.on('render-process-gone', (_e, d) => finish({ error: 'render-process-gone: ' + JSON.stringify(d) }))
  const extra = process.env.BENCH_SESSION ? JSON.parse(process.env.BENCH_SESSION) : {}
  const q = new URLSearchParams({ cfg: JSON.stringify({ ...cfg, ...extra, images: IMAGES, warmRuns: WARM_RUNS }) })
  win.loadURL('bench://app/page.html?' + q)
}

const TIMEOUT_MS = 15 * 60 * 1000
setTimeout(() => finish({ error: 'timeout after ' + TIMEOUT_MS + ' ms' }), TIMEOUT_MS)

app.whenReady().then(() => {
  sampleVram()
  if (cfg.kind === 'node') {
    // give the vram baseline sample time to land
    setTimeout(() => runNodeCase().then(finish, (e) => finish({ error: String(e?.stack ?? e) })), 500)
  } else {
    setTimeout(runRendererCase, 500)
  }
})
