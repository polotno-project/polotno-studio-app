// Copies latin woff2 files (weights 400/700, normal/italic) from installed
// @fontsource packages into the renderer's public assets and emits
// src/renderer/src/fonts-manifest.json in the Polotno FONT[] shape.
// Run after changing FAMILIES: node scripts/fetch-fonts.mjs
// Both outputs are committed, so builds never need this script or the network.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const FONTS_DIR = path.join(ROOT, 'src/renderer/public/fonts')
const MANIFEST_PATH = path.join(ROOT, 'src/renderer/src/fonts-manifest.json')

// SDK defaults first (designs made elsewhere often use them), then the
// popular design set. Every family must have an installed @fontsource package.
const FAMILIES = [
  'Roboto',
  'Amatic SC',
  'Press Start 2P',
  'Marck Script',
  'Rubik Mono One',
  'Inter',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Oswald',
  'Raleway',
  'Nunito',
  'Rubik',
  'Ubuntu',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'Bebas Neue',
  'Anton',
  'Archivo',
  'Barlow',
  'Caveat',
  'Dancing Script',
  'Pacifico',
  'Lobster',
  'Shadows Into Light',
  'Permanent Marker',
  'Comfortaa',
  'Quicksand',
  'Josefin Sans',
  'Abril Fatface',
  'Cormorant Garamond',
  'DM Sans',
  'Space Grotesk',
  'Fira Sans'
]

const VARIANTS = [
  { weight: '400', style: 'normal' },
  { weight: '400', style: 'italic' },
  { weight: '700', style: 'normal' },
  { weight: '700', style: 'italic' }
]

function slug(family) {
  return family.toLowerCase().replace(/\s+/g, '-')
}

await fs.rm(FONTS_DIR, { recursive: true, force: true })
await fs.mkdir(FONTS_DIR, { recursive: true })

const manifest = []
let copied = 0
for (const family of FAMILIES) {
  const pkgFiles = path.join(ROOT, 'node_modules', '@fontsource', slug(family), 'files')
  const styles = []
  for (const { weight, style } of VARIANTS) {
    const fileName = `${slug(family)}-latin-${weight}-${style}.woff2`
    try {
      await fs.copyFile(path.join(pkgFiles, fileName), path.join(FONTS_DIR, fileName))
    } catch {
      continue // family does not ship this variant
    }
    styles.push({ src: `./fonts/${fileName}`, fontStyle: style, fontWeight: weight })
    copied++
  }
  if (styles.length === 0) {
    console.error(`WARNING: no variants found for "${family}" — is @fontsource/${slug(family)} installed?`)
    continue
  }
  manifest.push({ fontFamily: family, styles })
}

await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2))
console.log(`${manifest.length} families, ${copied} files -> ${path.relative(ROOT, FONTS_DIR)}`)
