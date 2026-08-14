import { downloadFile } from 'polotno/utils/download'
import type { PDFExportOptions } from 'polotno/model/store'
import type { DesignStore } from './store'

// Client-side export helpers, ported from studio-automation editor-export.ts.
// Every format renders locally via the store. In Electron a triggered download
// opens the native save dialog, so these behave like Save As out of the box.

export type RasterFormat = 'png' | 'jpeg'
export type ExportFormat = RasterFormat | 'pdf' | 'pdf-vector' | 'svg' | 'html' | 'gif' | 'json' | 'mp4'

const CROP_MARK_SIZE = 20

export function getDesignFileName(store: DesignStore): string {
  const texts: string[] = []
  store.pages.forEach((page) => {
    page.children.forEach((child) => {
      if (child.type === 'text' && typeof child.text === 'string') {
        texts.push(child.text)
      }
    })
  })
  const words = texts.join(' ').split(' ').slice(0, 6)
  return words.join(' ').replace(/\s/g, '-').toLowerCase() || 'polotno'
}

function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return window.btoa(binary)
}

export async function exportImages(
  store: DesignStore,
  format: RasterFormat,
  quality = 2
): Promise<void> {
  const name = getDesignFileName(store)
  const mimeType: 'image/png' | 'image/jpeg' = `image/${format}`
  const multiPage = store.pages.length > 1

  if (store.pages.length < 3) {
    for (const [index, page] of store.pages.entries()) {
      const suffix = multiPage ? `-${index + 1}` : ''
      await store.saveAsImage({
        pageId: page.id,
        pixelRatio: quality,
        mimeType,
        fileName: `${name}${suffix}.${format}`
      })
    }
    return
  }

  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  for (const [index, page] of store.pages.entries()) {
    const url = await store.toDataURL({ pageId: page.id, pixelRatio: quality, mimeType })
    const base64 = url.replace(/^data:image\/(png|jpeg);base64,/, '')
    zip.file(`${name}-${index + 1}.${format}`, base64, { base64: true })
  }
  const content = await zip.generateAsync({ type: 'base64' })
  await downloadFile(`data:application/zip;base64,${content}`, `${name}.zip`)
}

export async function exportFlatPdf(
  store: DesignStore,
  options: { quality?: number; pageSizeModifier?: number; cropMarksAndBleed?: boolean } = {}
): Promise<void> {
  const { quality = 1, pageSizeModifier = 1, cropMarksAndBleed = false } = options
  const exportOptions: PDFExportOptions & { fileName: string } = {
    fileName: `${getDesignFileName(store)}.pdf`,
    dpi: store.dpi / pageSizeModifier,
    pixelRatio: quality * Math.sqrt(300 / 72)
  }
  if (cropMarksAndBleed) {
    exportOptions.includeBleed = true
    exportOptions.cropMarkSize = CROP_MARK_SIZE
  }
  await store.saveAsPDF(exportOptions)
}

// Non-flattened PDF: text and shapes stay selectable vectors.
export async function exportVectorPdf(
  store: DesignStore,
  options: { cropMarksAndBleed?: boolean } = {}
): Promise<void> {
  const { jsonToPDFBlob } = await import('@polotno/pdf-export/browser')
  const attrs: { includeBleed?: boolean; cropMarkSize?: number } = {}
  if (options.cropMarksAndBleed) {
    attrs.includeBleed = true
    attrs.cropMarkSize = CROP_MARK_SIZE
  }
  // pdf-export's input type is narrower than the store snapshot type; the
  // runtime shape is the same store.toJSON() document.
  const json = store.toJSON() as unknown as Parameters<typeof jsonToPDFBlob>[0]
  const blob = await jsonToPDFBlob(json, attrs)
  const url = URL.createObjectURL(blob)
  try {
    await downloadFile(url, `${getDesignFileName(store)}.pdf`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function exportSVG(store: DesignStore): Promise<void> {
  await store.saveAsSVG({ fileName: `${getDesignFileName(store)}.svg` })
}

export async function exportHTML(store: DesignStore): Promise<void> {
  await store.saveAsHTML({ fileName: `${getDesignFileName(store)}.html` })
}

export async function exportGIF(
  store: DesignStore,
  options: { quality?: number; fps?: number } = {}
): Promise<void> {
  await store.saveAsGIF({
    fileName: `${getDesignFileName(store)}.gif`,
    pixelRatio: options.quality ?? 1,
    fps: options.fps ?? 15
  })
}

export async function exportJSON(store: DesignStore): Promise<void> {
  const json = JSON.stringify(store.toJSON())
  const url = `data:text/json;base64,${utf8ToBase64(json)}`
  await downloadFile(url, `${getDesignFileName(store)}.json`)
}

export async function exportVideo(
  store: DesignStore,
  options: { quality?: number; fps?: number; onProgress?: (progress: number) => void } = {}
): Promise<void> {
  const { storeToVideo } = await import('@polotno/video-export')
  const blob = await storeToVideo({
    store,
    pixelRatio: options.quality ?? 1,
    fps: options.fps ?? 30,
    onProgress: (progress: number) => options.onProgress?.(progress * 100)
  })
  const url = URL.createObjectURL(blob)
  try {
    await downloadFile(url, `${getDesignFileName(store)}.mp4`)
  } finally {
    URL.revokeObjectURL(url)
  }
}
