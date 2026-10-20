import { promises as fs } from 'node:fs'
import { extname, isAbsolute } from 'node:path'

// Reads an image an agent left on disk (Codex writes generated images to
// files) and turns it into an embeddable data URL plus its natural size.
// Designs are self-contained JSON, so the bytes go into the design, not a path.

const MAX_BYTES = 25 * 1024 * 1024

export interface LocalImage {
  type: 'image' | 'svg'
  dataUrl: string
  width: number
  height: number
}

type Raster = { mimeType: string; width: number; height: number }

function pngSize(b: Buffer): Raster | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null
  return { mimeType: 'image/png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

function gifSize(b: Buffer): Raster | null {
  if (b.length < 10 || b.toString('ascii', 0, 3) !== 'GIF') return null
  return { mimeType: 'image/gif', width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
}

function jpegSize(b: Buffer): Raster | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++
      continue
    }
    const marker = b[i + 1]
    // SOF0–SOF15 carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { mimeType: 'image/jpeg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return null
}

function webpSize(b: Buffer): Raster | null {
  if (
    b.length < 30 ||
    b.toString('ascii', 0, 4) !== 'RIFF' ||
    b.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null
  }
  const chunk = b.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') {
    return {
      mimeType: 'image/webp',
      width: b.readUInt16LE(26) & 0x3fff,
      height: b.readUInt16LE(28) & 0x3fff
    }
  }
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return {
      mimeType: 'image/webp',
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    }
  }
  if (chunk === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: b.readUIntLE(24, 3) + 1,
      height: b.readUIntLE(27, 3) + 1
    }
  }
  return null
}

// SVG size from width/height attributes (unitless or px), else the viewBox.
function svgSize(text: string): { width: number; height: number } {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? ''
  const attr = (name: string): number | undefined => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`, 'i').exec(
      tag
    )?.[1]
    return value ? Number(value) : undefined
  }
  const viewBox = /\sviewBox\s*=\s*["']([^"']+)["']/i
    .exec(tag)?.[1]
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const width = attr('width') ?? viewBox?.[2]
  const height = attr('height') ?? viewBox?.[3]
  return width && height ? { width, height } : { width: 512, height: 512 }
}

export async function readLocalImage(filePath: string): Promise<LocalImage> {
  if (!isAbsolute(filePath)) throw new Error(`invalid_args: filePath must be absolute: ${filePath}`)
  const stat = await fs.stat(filePath).catch(() => null)
  if (!stat?.isFile()) throw new Error(`not_found: no file at ${filePath}`)
  if (stat.size > MAX_BYTES) {
    throw new Error(`invalid_args: ${filePath} is ${stat.size} bytes; the limit is ${MAX_BYTES}`)
  }
  const bytes = await fs.readFile(filePath)

  if (extname(filePath).toLowerCase() === '.svg') {
    const text = bytes.toString('utf8')
    if (!/<svg\b/i.test(text)) throw new Error(`invalid_args: ${filePath} is not an SVG`)
    return {
      type: 'svg',
      dataUrl: `data:image/svg+xml;base64,${bytes.toString('base64')}`,
      ...svgSize(text)
    }
  }

  const raster = pngSize(bytes) ?? jpegSize(bytes) ?? webpSize(bytes) ?? gifSize(bytes)
  if (!raster || !raster.width || !raster.height) {
    throw new Error(`invalid_args: ${filePath} is not a PNG, JPEG, WebP, GIF or SVG image`)
  }
  return {
    type: 'image',
    dataUrl: `data:${raster.mimeType};base64,${bytes.toString('base64')}`,
    width: raster.width,
    height: raster.height
  }
}
