import { createHash } from 'node:crypto'

// Embedded assets (place_image, uploads) live in the design as data URLs, and
// one photo is megabytes of base64 an agent would pay for on every read.
// get_design_json swaps each long data URL for a short reference; agents can
// pass a reference back anywhere a src goes, and it is restored from the
// current design before anything touches the store.

const MIN_ELIDED_LENGTH = 1024
const PREFIX = 'data-elided:'
const REF = /^data-elided:[^;]*;bytes=\d+;sha=([0-9a-f]{16})$/

function sha(dataUrl: string): string {
  return createHash('sha256').update(dataUrl).digest('hex').slice(0, 16)
}

function isLongDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_ELIDED_LENGTH && value.startsWith('data:')
}

function refFor(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  const mime = /^data:([^;,]*)/.exec(dataUrl)?.[1] || 'application/octet-stream'
  const bytes = Math.floor(((dataUrl.length - comma - 1) * 3) / 4)
  return `${PREFIX}${mime};bytes=${bytes};sha=${sha(dataUrl)}`
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]))
  }
  return value
}

function collect(value: unknown, out: Map<string, string>): Map<string, string> {
  if (isLongDataUrl(value)) out.set(sha(value), value)
  else if (Array.isArray(value)) for (const item of value) collect(item, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) collect(v, out)
  return out
}

export function elideDataUrls(design: unknown): unknown {
  return mapStrings(design, (s) => (isLongDataUrl(s) ? refFor(s) : s))
}

// Only the full reference grammar counts: text that merely starts with the
// prefix (a caption, say) is left alone.
export function hasDataRefs(value: unknown): boolean {
  if (typeof value === 'string') return REF.test(value)
  if (Array.isArray(value)) return value.some(hasDataRefs)
  if (value && typeof value === 'object') return Object.values(value).some(hasDataRefs)
  return false
}

// Replaces every reference in `value` with the data URL it names, looked up
// in `design`. An unknown reference is an error, never a broken image.
export function restoreDataUrls<T>(value: T, design: unknown): T {
  if (!hasDataRefs(value)) return value
  const known = collect(design, new Map())
  return mapStrings(value, (s) => {
    const hash = REF.exec(s)?.[1]
    if (!hash) return s
    const dataUrl = known.get(hash)
    if (!dataUrl) {
      throw new Error(
        `invalid_args: ${s} does not match any embedded asset in this design. Re-read with get_design_json.`
      )
    }
    return dataUrl
  }) as T
}
