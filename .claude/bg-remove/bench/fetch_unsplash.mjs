// Downloads a test set of Unsplash photos through Polotno's asset proxy (same source as the app's Photos panel),
// using the vendored polotno-design skill's search. Writes images/u-<slug>.jpg and unsplash-manifest.json, and
// prints the BENCH_ORDER list: `node fetch_unsplash.mjs`
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const RESOLVE = path.join(ROOT, '../../../vendor/skills/polotno-design/scripts/resolve-assets.js')
// typical "remove background" subjects in a design editor: people, pets, products, fine detail
const QUERIES = [
  'woman portrait', 'man portrait smiling', 'curly hair woman', 'child portrait', 'business man suit',
  'couple outdoors', 'group of friends', 'long hair wind', 'athlete running', 'woman with hat',
  'dog', 'cat', 'parrot bird', 'horse',
  'sneakers', 'perfume bottle', 'coffee cup', 'headphones', 'wrist watch', 'handbag', 'skincare bottle',
  'armchair', 'potted plant', 'bicycle', 'red car', 'burger', 'birthday cake', 'wine glass', 'laptop desk',
  'flower bouquet'
]

const manifest = []
for (const q of QUERIES) {
  const slug = 'u-' + q.replace(/\s+/g, '-')
  const file = path.join(ROOT, 'images', slug + '.jpg')
  const res = JSON.parse(execFileSync(process.execPath, [RESOLVE, 'search', 'photo', q], { encoding: 'utf8' }))
  if (!res.length) {
    console.log(`${q}: no results`)
    continue
  }
  const { url } = res[0]
  if (!fs.existsSync(file)) {
    const r = await fetch(url)
    if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) {
      console.log(`${q}: ${r.status} ${r.headers.get('content-type')}`)
      continue
    }
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  }
  manifest.push({ name: slug, query: q, url: url.replace(/[?&](ixid|ixlib)=[^&]*/g, '') })
  console.log(`${q}: ${(fs.statSync(file).size / 1024) | 0} KB`)
}
fs.writeFileSync(path.join(ROOT, 'unsplash-manifest.json'), JSON.stringify(manifest, null, 1) + '\n')
console.log('\nBENCH_ORDER=' + manifest.map((m) => m.name).join(','))
