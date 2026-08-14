import { useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { tabs } from './tabs-model'
import {
  exportImages,
  exportFlatPdf,
  exportVectorPdf,
  exportSVG,
  exportHTML,
  exportGIF,
  exportJSON,
  exportVideo,
  type ExportFormat
} from './export'

const FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'png', label: 'PNG image' },
  { format: 'jpeg', label: 'JPEG image' },
  { format: 'pdf', label: 'PDF (flattened)' },
  { format: 'pdf-vector', label: 'PDF (vector)' },
  { format: 'svg', label: 'SVG' },
  { format: 'html', label: 'HTML' },
  { format: 'gif', label: 'Animated GIF' },
  { format: 'mp4', label: 'MP4 video' },
  { format: 'json', label: 'JSON (design file)' }
]

export async function runExport(format: ExportFormat): Promise<void> {
  const tab = tabs.active
  if (!tab) return
  const store = tab.store
  try {
    switch (format) {
      case 'png':
      case 'jpeg':
        await exportImages(store, format)
        break
      case 'pdf':
        await exportFlatPdf(store)
        break
      case 'pdf-vector':
        await exportVectorPdf(store)
        break
      case 'svg':
        await exportSVG(store)
        break
      case 'html':
        await exportHTML(store)
        break
      case 'gif':
        await exportGIF(store)
        break
      case 'mp4': {
        const id = toast.loading('Rendering video… 0%')
        try {
          await exportVideo(store, {
            onProgress: (p) => toast.loading(`Rendering video… ${Math.round(p)}%`, { id })
          })
          toast.success('Video exported', { id })
        } catch (error) {
          toast.error('Video export failed', { id })
          throw error
        }
        break
      }
      case 'json':
        await exportJSON(store)
        break
    }
  } catch (error) {
    console.error('Export failed', format, error)
    toast.error(`Export failed (${format}).`)
  }
}

export const ExportMenu = observer(function ExportMenu(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={rootRef} className="relative ml-auto self-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mr-1 flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
      >
        <Download className="size-3.5" />
        Export
      </button>
      {open && (
        <div className="absolute right-1 z-50 mt-1 w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          {FORMATS.map(({ format, label }) => (
            <button
              key={format}
              onClick={() => {
                setOpen(false)
                void runExport(format)
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
