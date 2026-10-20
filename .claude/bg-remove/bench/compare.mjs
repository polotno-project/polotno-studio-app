// Compares each case's full-res alpha to the onnxruntime-node CPU fp32 reference and
// prints a markdown table of all results: `node compare.mjs`
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(ROOT, 'out')
const REF = 'node-cpu-fp32'
const IMAGES = ['portrait', 'dog', 'product', 'busy']

function diff(a, b) {
  if (!a || !b || a.length !== b.length) return null
  let sad = 0
  let inter = 0
  let union = 0
  let bad = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    sad += d
    if (d > 32) bad++
    const fa = a[i] >= 128
    const fb = b[i] >= 128
    if (fa && fb) inter++
    if (fa || fb) union++
  }
  return { mad: sad / a.length, iou: union ? inter / union : 1, badPct: (100 * bad) / a.length }
}
const read = (c, img) => {
  const f = path.join(OUT, c, img + '.alpha')
  return fs.existsSync(f) ? fs.readFileSync(f) : null
}
const f0 = (x) => (x == null ? '—' : Math.round(x).toLocaleString('en-US'))
const rows = []
const ids = fs.readdirSync(OUT).filter((d) => fs.existsSync(path.join(OUT, d, 'result.json')))
const all = {}
for (const id of ids) {
  const r = JSON.parse(fs.readFileSync(path.join(OUT, id, 'result.json'), 'utf8'))
  const per = IMAGES.map((img) => diff(read(id, img), read(REF, img)))
  const ok = per.every(Boolean)
  const worstIou = ok ? Math.min(...per.map((p) => p.iou)) : null
  const maxMad = ok ? Math.max(...per.map((p) => p.mad)) : null
  const nan = r.images ? Object.values(r.images).reduce((s, x) => s + (x.nanCount ?? 0), 0) : null
  all[id] = { per, nan }
  const load = r.kind === 'tfjs' ? r.loadMs : r.loadMs
  rows.push(
    `| ${id} | ${r.error ? 'FAIL' : 'ok'} | ${f0(r.fetchMs)} | ${f0(load)} | ${f0(r.firstInferMs)} | ${f0(r.warmMedianMs)} | ` +
      `${f0(r.memory?.rendererPrivatePeakMB || null)} | ${f0(r.memory?.gpuProcessPrivatePeakMB)} | ${f0(r.memory?.mainProcessPrivatePeakMB)} | ${f0(r.memory?.vramDeltaPeakMB)} | ` +
      `${maxMad == null ? '—' : maxMad.toFixed(2)} | ${worstIou == null ? '—' : worstIou.toFixed(4)} | ${nan ?? '—'} |`
  )
}
console.log(
  '| case | status | fetch ms | load ms | 1st infer ms | warm median ms | renderer MB | GPU proc MB | main MB | VRAM Δ MB | max MAD vs ref (0–255) | worst IoU vs ref | NaN logits |'
)
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
console.log(rows.join('\n'))
fs.writeFileSync(path.join(OUT, 'compare.json'), JSON.stringify(all, null, 1))
