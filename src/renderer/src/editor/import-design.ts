import { validateDesign } from '@polotno/schema'

export type DesignFileKind = 'project' | 'pdf' | 'svg'

// Route a selected/dropped file to its importer by extension/MIME type.
// Returns null for unsupported files. Ported from studio-automation.
export function designFileKind(file: { name: string; type: string }): DesignFileKind | null {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type === 'application/pdf' || name.endsWith('.pdf') || name.endsWith('.ai')) return 'pdf'
  if (type === 'image/svg+xml' || name.endsWith('.svg')) return 'svg'
  if (name.endsWith('.json') || name.endsWith('.polotno')) return 'project'
  return null
}

export function kindFromPath(filePath: string): DesignFileKind | null {
  return designFileKind({ name: filePath, type: '' })
}

function assertValidDesign(json: unknown, code: string): void {
  const result = validateDesign(json)
  if (!result.valid) {
    console.error('Design validation errors:', result.errors)
    throw new Error(code)
  }
}

/** Parse a Polotno project file's text. Throws `invalid-json` / `invalid-project`. */
export function parseProjectText(text: string): unknown {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('invalid-json')
  }
  assertValidDesign(json, 'invalid-project')
  return json
}

/** Parse a PDF/AI buffer into Polotno JSON via the lazily-loaded importer. */
export async function parsePdfBuffer(pdf: ArrayBuffer): Promise<unknown> {
  const { pdfToJson } = await import('@polotno/pdf-import')
  return pdfToJson({ pdf })
}

/** Parse SVG markup into Polotno JSON via the lazily-loaded importer. Throws `invalid-svg`. */
export async function parseSvgText(svg: string): Promise<unknown> {
  const { svgToJson } = await import('@polotno/svg-import')
  const json = await svgToJson({ svg })
  assertValidDesign(json, 'invalid-svg')
  return json
}

/** Dispatch a dropped File to the right parser. Returns null for unsupported types. */
export async function parseDesignFile(file: File): Promise<unknown | null> {
  switch (designFileKind(file)) {
    case 'project':
      return parseProjectText(await file.text())
    case 'pdf':
      return parsePdfBuffer(await file.arrayBuffer())
    case 'svg':
      return parseSvgText(await file.text())
    default:
      return null
  }
}
