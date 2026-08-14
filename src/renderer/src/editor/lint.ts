import Konva from 'konva'
import type { DesignStore } from './store'

export interface LintFinding {
  pageId: string
  elementId?: string
  rule:
    | 'empty-page'
    | 'out-of-bounds'
    | 'tiny-text'
    | 'text-overflow'
    | 'low-contrast'
    | 'overlapping-text'
    | 'missing-font'
    | 'broken-asset'
  severity: 'error' | 'warning'
  message: string
  suggestion?: string
}

interface ElementJson {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  text?: string
  fontSize?: number
  fontFamily?: string
  fill?: string
  lineHeight?: number
  src?: string
  visible?: boolean
}

interface PageJson {
  id: string
  children: ElementJson[]
  background?: string
  width?: number | string
  height?: number | string
}

// Axis-aligned bbox of a (possibly rotated) element. Polotno rotates around
// the top-left corner.
function bbox(el: ElementJson): { x: number; y: number; width: number; height: number } {
  const rotation = ((el.rotation ?? 0) * Math.PI) / 180
  if (!rotation) return { x: el.x, y: el.y, width: el.width, height: el.height }
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const corners = [
    [0, 0],
    [el.width, 0],
    [el.width, el.height],
    [0, el.height]
  ].map(([dx, dy]) => [el.x + dx * cos - dy * sin, el.y + dx * sin + dy * cos])
  const xs = corners.map((c) => c[0])
  const ys = corners.map((c) => c[1])
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const int = parseInt(match[1], 16)
  const channels = [int >> 16, (int >> 8) & 255, int & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// Measured height of a text element's content via an offscreen Konva.Text —
// works for background tabs too (no mounted editor needed).
function measuredTextHeight(el: ElementJson): number {
  const node = new Konva.Text({
    text: el.text ?? '',
    fontSize: el.fontSize ?? 12,
    fontFamily: el.fontFamily ?? 'Arial',
    lineHeight: el.lineHeight ?? 1.2,
    width: el.width,
    wrap: 'word'
  })
  const height = node.height()
  node.destroy()
  return height
}

const assetProbeCache = new Map<string, boolean>()

function probeImage(src: string): Promise<boolean> {
  const cached = assetProbeCache.get(src)
  if (cached !== undefined) return Promise.resolve(cached)
  return new Promise((resolve) => {
    const img = new Image()
    const done = (ok: boolean): void => {
      assetProbeCache.set(src, ok)
      resolve(ok)
    }
    const timer = setTimeout(() => done(false), 5000)
    img.onload = () => {
      clearTimeout(timer)
      done(true)
    }
    img.onerror = () => {
      clearTimeout(timer)
      done(false)
    }
    img.src = src
  })
}

export async function lintDesign(store: DesignStore, onlyPageId?: string): Promise<LintFinding[]> {
  const json = store.toJSON() as unknown as { width: number; height: number; pages: PageJson[] }
  const findings: LintFinding[] = []
  const pages = json.pages.filter((page) => !onlyPageId || page.id === onlyPageId)

  for (const page of pages) {
    const pageWidth = typeof page.width === 'number' ? page.width : json.width
    const pageHeight = typeof page.height === 'number' ? page.height : json.height
    const children = page.children.filter((el) => el.visible !== false)

    if (children.length === 0) {
      findings.push({
        pageId: page.id,
        rule: 'empty-page',
        severity: 'warning',
        message: 'The page has no elements.'
      })
      continue
    }

    const texts = children.filter((el) => el.type === 'text')

    for (const el of children) {
      const box = bbox(el)
      if (
        box.x + box.width < 0 ||
        box.y + box.height < 0 ||
        box.x > pageWidth ||
        box.y > pageHeight
      ) {
        findings.push({
          pageId: page.id,
          elementId: el.id,
          rule: 'out-of-bounds',
          severity: 'error',
          message: `Element ${el.id} (${el.type}) is completely outside the page.`,
          suggestion: 'Move it inside the page or remove it.'
        })
      } else if (
        box.x < -1 ||
        box.y < -1 ||
        box.x + box.width > pageWidth + 1 ||
        box.y + box.height > pageHeight + 1
      ) {
        // Backgrounds intentionally bleed; only flag non-full-bleed elements.
        const coversPage = box.width >= pageWidth && box.height >= pageHeight
        if (!coversPage) {
          findings.push({
            pageId: page.id,
            elementId: el.id,
            rule: 'out-of-bounds',
            severity: 'warning',
            message: `Element ${el.id} (${el.type}) extends beyond the page edge.`
          })
        }
      }

      if ((el.type === 'image' || el.type === 'video' || el.type === 'svg') && el.src) {
        if (!(await probeImage(el.src)) && el.type !== 'video') {
          findings.push({
            pageId: page.id,
            elementId: el.id,
            rule: 'broken-asset',
            severity: 'error',
            message: `The ${el.type} source failed to load.`,
            suggestion: 'Replace the src URL with a working asset.'
          })
        }
      }
    }

    for (const el of texts) {
      if ((el.fontSize ?? 12) < 10) {
        findings.push({
          pageId: page.id,
          elementId: el.id,
          rule: 'tiny-text',
          severity: 'warning',
          message: `Text is ${el.fontSize}px — likely unreadable at export size.`
        })
      }

      const measured = measuredTextHeight(el)
      // height <= 1 means the element has not rendered yet (auto-height) —
      // there is nothing to overflow.
      if (el.height > 1 && measured > el.height * 1.05 + 2) {
        findings.push({
          pageId: page.id,
          elementId: el.id,
          rule: 'text-overflow',
          severity: 'error',
          message: `Text needs ~${Math.ceil(measured)}px height but the element is ${Math.round(el.height)}px.`,
          suggestion: 'Increase the element height, shorten the text, or reduce fontSize.'
        })
      }

      if (el.fontFamily && !document.fonts.check(`16px "${el.fontFamily}"`)) {
        findings.push({
          pageId: page.id,
          elementId: el.id,
          rule: 'missing-font',
          severity: 'warning',
          message: `Font "${el.fontFamily}" is not loaded; a fallback will render.`
        })
      }

      if (el.fill && typeof page.background === 'string') {
        const ratio = contrastRatio(el.fill, page.background)
        if (ratio !== null && ratio < 3) {
          findings.push({
            pageId: page.id,
            elementId: el.id,
            rule: 'low-contrast',
            severity: ratio < 1.5 ? 'error' : 'warning',
            message: `Text contrast against the page background is ${ratio.toFixed(1)}:1 (below 3:1).`,
            suggestion: 'Pick a darker/lighter text color or add a backdrop shape.'
          })
        }
      }
    }

    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = bbox(texts[i])
        const b = bbox(texts[j])
        const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        if (overlapW <= 0 || overlapH <= 0) continue
        const overlap = overlapW * overlapH
        const smaller = Math.min(a.width * a.height, b.width * b.height)
        if (smaller > 0 && overlap / smaller > 0.25) {
          findings.push({
            pageId: page.id,
            elementId: texts[i].id,
            rule: 'overlapping-text',
            severity: 'warning',
            message: `Text elements ${texts[i].id} and ${texts[j].id} overlap by ${Math.round((overlap / smaller) * 100)}%.`
          })
        }
      }
    }
  }

  return findings
}
