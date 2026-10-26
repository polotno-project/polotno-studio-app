// Runs each case in a fresh Electron process: `node run.mjs [caseId ...]`
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// the repo's electron package exports its binary path (electron.exe / Electron.app/... / electron)
const ELECTRON = createRequire(path.join(ROOT, '../../../package.json'))('electron')
const ALL = [
  'node-cpu-fp32', // reference for correctness
  'node-dml-fp16',
  'node-dml-fp32',
  'node-dml-patched',
  'node-dml-chunked32',
  'node-cpu-isnet32', // IS-Net reference: REF=node-cpu-isnet32 node compare.mjs
  'node-dml-isnet32',
  'node-dml-isnet16',
  'ort-webgpu-native-fp16',
  'ort-webgpu-native-fp32',
  'ort-webgpu-native-patched',
  'ort-webgpu-native-chunked32', // deform_chunk.py + patch_webgpu.py
  'ort-webgpu-native-chunked16',
  'ort-webgpu-native-isnet32', // export_isnet.py
  'ort-webgpu-native-isnet16',
  'ort-webgpu-jsep-fp16',
  'ort-webgpu-jsep-fp32',
  'ort-webgpu-jsep-patched',
  'ort-wasm-fp16',
  'ort-wasm-fp32',
  'ort-wasm-patched',
  'ort-wasm-chunked32',
  'ort-wasm-isnet32',
  'ort-wasm-isnet16',
  'tfjs-webgpu-fp16',
  'tfjs-webgpu-fp32',
  'tfjs-wasm-fp16',
  'tfjs-wasm-fp32'
]
const cases = process.argv.length > 2 ? process.argv.slice(2) : ALL
for (const id of cases) {
  const dir = path.join(ROOT, process.env.BENCH_OUT || 'out', id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const t = Date.now()
  const r = spawnSync(ELECTRON, [path.join(ROOT, 'main.cjs'), id], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  fs.writeFileSync(path.join(dir, 'stdout.log'), out)
  const done = out.split('\n').filter((l) => l.includes('] done '))
  console.log(`${id} (${((Date.now() - t) / 1000).toFixed(0)} s, exit ${r.status}): ${done.at(-1) ?? 'NO RESULT'}`)
}
