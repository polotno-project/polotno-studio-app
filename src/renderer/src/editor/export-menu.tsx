import { observer } from 'mobx-react-lite'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from 'polotno/primitives/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from 'polotno/primitives/dropdown-menu'
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
  type MenuFormat
} from './export'

const FORMATS: { format: MenuFormat; label: string }[] = [
  { format: 'png', label: 'PNG image' },
  { format: 'jpeg', label: 'JPEG image' },
  { format: 'pdf', label: 'PDF' },
  { format: 'pdf-flat', label: 'PDF (flattened)' },
  { format: 'svg', label: 'SVG' },
  { format: 'html', label: 'HTML' },
  { format: 'gif', label: 'Animated GIF' },
  { format: 'mp4', label: 'MP4 video' },
  { format: 'json', label: 'JSON (design file)' }
]

export async function runExport(format: MenuFormat): Promise<void> {
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
        await exportVectorPdf(store)
        break
      case 'pdf-flat':
        await exportFlatPdf(store)
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
    // A vector PDF embeds every font, so one that cannot load fails the
    // export. Point at the format that always works rather than a dead end.
    if (format === 'pdf' && (error as { code?: string }).code === 'FONT_FAILED') {
      toast.error('PDF export failed: a font could not be loaded. Try PDF (flattened).')
      return
    }
    toast.error(`Export failed (${format}).`)
  }
}

export const ExportMenu = observer(function ExportMenu(): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm">
            <Download className="size-3.5" />
            Export
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {FORMATS.map(({ format, label }) => (
          <DropdownMenuItem key={format} onSelect={() => void runExport(format)}>
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
