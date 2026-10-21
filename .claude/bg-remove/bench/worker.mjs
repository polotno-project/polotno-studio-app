// BiRefNet_lite benchmark — renderer Web Worker. Runs one case (onnxruntime-web or transformers.js).
const post = (m, transfer) => self.postMessage(m, transfer ?? [])
const logs = []
const log = (msg) => {
  msg = String(msg).slice(0, 2000)
  if (msg.includes('CleanUnusedInitializers') || msg.includes('constant_folding.cc')) return
  logs.push(msg)
  post({ type: 'log', msg })
}
for (const k of ['log', 'info', 'warn']) {
  const orig = console[k].bind(console)
  console[k] = (...a) => {
    orig(...a)
    log(`console.${k}: ` + a.map((x) => (x instanceof Error ? x.stack : typeof x === 'object' ? safeJson(x) : x)).join(' '))
  }
}
function safeJson(x) {
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const S = 1024
const countNaN = (a) => {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== a[i]) n++
  return n
}
// same as prob.cjs: 'sigmoid' for BiRefNet logits, 'minmax' for IS-Net's sigmoid output (per-image min-max)
function toProb(out, mode) {
  const p = new Float32Array(out.length)
  if (mode === 'minmax') {
    let mi = Infinity
    let ma = -Infinity
    for (const v of out) {
      if (v < mi) mi = v
      if (v > ma) ma = v
    }
    const k = ma > mi ? 1 / (ma - mi) : 0
    for (let i = 0; i < out.length; i++) p[i] = (out[i] - mi) * k
  } else if (mode === 'identity') {
    p.set(out)
  } else {
    for (let i = 0; i < out.length; i++) p[i] = 1 / (1 + Math.exp(-out[i]))
  }
  return p
}

async function loadBitmap(name) {
  const blob = await (await fetch(`/images/${name}.jpg`)).blob()
  return { blob, bmp: await createImageBitmap(blob) }
}

function preprocess(bmp, { mean: MEAN, std: STD }) {
  const c = new OffscreenCanvas(S, S)
  const g = c.getContext('2d', { willReadFrequently: true })
  g.imageSmoothingQuality = 'high'
  g.drawImage(bmp, 0, 0, S, S)
  const d = g.getImageData(0, 0, S, S).data
  const N = S * S
  const chw = new Float32Array(3 * N)
  for (let i = 0; i < N; i++) {
    chw[i] = (d[i * 4] / 255 - MEAN[0]) / STD[0]
    chw[N + i] = (d[i * 4 + 1] / 255 - MEAN[1]) / STD[1]
    chw[2 * N + i] = (d[i * 4 + 2] / 255 - MEAN[2]) / STD[2]
  }
  return chw
}

// logits (1024x1024) -> full-res alpha + cutout PNG
async function postprocess(bmp, logits, mode) {
  const N = S * S
  const prob = toProb(logits, mode)
  const mi = new ImageData(S, S)
  for (let i = 0; i < N; i++) {
    mi.data[i * 4] = mi.data[i * 4 + 1] = mi.data[i * 4 + 2] = 255
    mi.data[i * 4 + 3] = 255 * prob[i]
  }
  const mc = new OffscreenCanvas(S, S)
  mc.getContext('2d').putImageData(mi, 0, 0)
  const W = bmp.width
  const H = bmp.height
  const oc = new OffscreenCanvas(W, H)
  const og = oc.getContext('2d', { willReadFrequently: true })
  og.imageSmoothingQuality = 'high'
  og.drawImage(mc, 0, 0, W, H)
  const md = og.getImageData(0, 0, W, H).data
  const alpha = new Uint8Array(W * H)
  for (let i = 0; i < alpha.length; i++) alpha[i] = md[i * 4 + 3]
  return { alpha, png: await rgbaWithAlpha(bmp, alpha) }
}

async function rgbaWithAlpha(bmp, alpha) {
  const W = bmp.width
  const H = bmp.height
  const oc = new OffscreenCanvas(W, H)
  const og = oc.getContext('2d', { willReadFrequently: true })
  og.drawImage(bmp, 0, 0)
  const id = og.getImageData(0, 0, W, H)
  for (let i = 0; i < alpha.length; i++) id.data[i * 4 + 3] = alpha[i]
  og.putImageData(id, 0, 0)
  return new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

function save(name, bytes) {
  post({ type: 'save', name, bytes: bytes.buffer }, [bytes.buffer])
}

async function runOrt(cfg, result) {
  let stage = 'import'
  try {
    const mod = await import('/' + cfg.bundle)
    const ort = mod.InferenceSession ? mod : mod.default
    result.ortVersion = ort.env.versions?.web ?? ort.env.versions
    ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/'
    ort.env.logLevel = 'warning'
    if (cfg.numThreads) ort.env.wasm.numThreads = cfg.numThreads
    stage = 'fetch-model'
    let t = performance.now()
    const bytes = new Uint8Array(await (await fetch('/' + cfg.model)).arrayBuffer())
    result.fetchMs = performance.now() - t
    stage = 'create-session'
    t = performance.now()
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: [cfg.ep],
      logSeverityLevel: 2,
      ...(cfg.sessionOptions ?? {})
    })
    result.loadMs = performance.now() - t
    result.wasmNumThreads = ort.env.wasm.numThreads
    log(`session created in ${result.loadMs.toFixed(0)} ms (numThreads=${ort.env.wasm.numThreads})`)
    const run = async (chw) => {
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, S, S]) })
      return out[session.outputNames[0]].data
    }
    result.images = {}
    for (const [idx, name] of cfg.images.entries()) {
      stage = 'infer:' + name
      const { bmp } = await loadBitmap(name)
      let t0 = performance.now()
      const chw = preprocess(bmp, cfg.prep)
      const preMs = performance.now() - t0
      t0 = performance.now()
      const logits = await run(chw)
      const runMs = performance.now() - t0
      t0 = performance.now()
      const { alpha, png } = await postprocess(bmp, logits, cfg.prep.out)
      const postMs = performance.now() - t0
      result.images[name] = { preMs, runMs, postMs, width: bmp.width, height: bmp.height, nanCount: countNaN(logits) }
      save(name + '.alpha', alpha)
      save(name + '.png', png)
      log(`${name}: run ${runMs.toFixed(0)} ms`)
      if (idx === 0) {
        result.firstInferMs = runMs
        stage = 'warm'
        const warm = []
        const warmNan = []
        for (let i = 0; i < cfg.warmRuns; i++) {
          const t1 = performance.now()
          const l = await run(chw)
          warm.push(performance.now() - t1)
          warmNan.push(countNaN(l))
        }
        result.warmRunsMs = warm
        result.warmNanCounts = warmNan
        result.warmMedianMs = median(warm)
      }
    }
    result.summary = { fetchMs: result.fetchMs, loadMs: result.loadMs, firstInferMs: result.firstInferMs, warmMedianMs: result.warmMedianMs }
  } catch (e) {
    result.error = `[${stage}] ` + (e?.stack ?? e?.message ?? String(e))
  }
}

async function runTfjs(cfg, result) {
  let stage = 'import'
  try {
    const T = await import('/node_modules/@huggingface/transformers/dist/transformers.js')
    T.env.allowRemoteModels = false
    T.env.allowLocalModels = true
    T.env.localModelPath = '/models/hf/'
    T.env.useBrowserCache = false
    T.env.backends.onnx.wasm.wasmPaths = '/node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist/'
    result.transformersVersion = T.env.version
    result.ortVersion = T.env.backends.onnx.versions ?? null
    stage = 'pipeline'
    let t = performance.now()
    const pipe = await T.pipeline('background-removal', 'onnx-community/BiRefNet_lite-ONNX', {
      device: cfg.device,
      dtype: cfg.dtype
    })
    result.loadMs = performance.now() - t // includes model fetch
    log(`pipeline created in ${result.loadMs.toFixed(0)} ms`)
    result.images = {}
    for (const [idx, name] of cfg.images.entries()) {
      stage = 'infer:' + name
      const { blob, bmp } = await loadBitmap(name)
      const raw = await T.RawImage.fromBlob(blob)
      let t0 = performance.now()
      let out = await pipe(raw)
      const runMs = performance.now() - t0 // end-to-end incl. pre/post inside the pipeline
      out = Array.isArray(out) ? out[0] : out
      const alpha = new Uint8Array(out.width * out.height)
      for (let i = 0; i < alpha.length; i++) alpha[i] = out.data[i * out.channels + out.channels - 1]
      result.images[name] = { runMs, width: out.width, height: out.height, channels: out.channels }
      save(name + '.alpha', alpha)
      save(name + '.png', await rgbaWithAlpha(bmp, alpha))
      log(`${name}: e2e ${runMs.toFixed(0)} ms`)
      if (idx === 0) {
        result.firstInferMs = runMs
        stage = 'warm'
        const warm = []
        for (let i = 0; i < cfg.warmRuns; i++) {
          const t1 = performance.now()
          await pipe(raw)
          warm.push(performance.now() - t1)
        }
        result.warmRunsMs = warm
        result.warmMedianMs = median(warm)
      }
    }
    result.summary = { loadMs: result.loadMs, firstInferMs: result.firstInferMs, warmMedianMs: result.warmMedianMs, note: 'times are pipeline end-to-end' }
  } catch (e) {
    result.error = `[${stage}] ` + (e?.stack ?? e?.message ?? String(e))
  }
}

self.onmessage = async ({ data: cfg }) => {
  const result = { workerCrossOriginIsolated: self.crossOriginIsolated }
  if (cfg.kind === 'ort') await runOrt(cfg, result)
  else await runTfjs(cfg, result)
  result.logs = logs.slice(0, 200)
  post({ type: 'done', result })
}
