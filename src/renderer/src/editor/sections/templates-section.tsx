import { observer } from 'mobx-react-lite'
import { SectionTab, type Section } from 'polotno/side-panel'
import { ImagesGrid } from 'polotno/side-panel/images-grid'
import { LayoutTemplate } from 'lucide-react'
import { toast } from 'sonner'
import type { DesignStore } from '../store'
import { tabs } from '../tabs-model'

interface TemplateEntry {
  name: string
  preview: string
  load: () => Promise<{ default: unknown }>
}

// Bundled template pack: JSON is code-split into the bundle (fetch of local
// files is blocked on file:// pages); previews are plain static images.
const TEMPLATES: TemplateEntry[] = [
  {
    name: 'Welcome',
    preview: './templates/welcome.jpg',
    load: () => import('../../templates/welcome.json')
  },
  {
    name: 'Social Media Post',
    preview: './templates/social-media-post.jpg',
    load: () => import('../../templates/social-media-post.json')
  },
  {
    name: 'Basic Poster',
    preview: './templates/basic-poster.jpg',
    load: () => import('../../templates/basic-poster.json')
  },
  {
    name: 'Animated Video',
    preview: './templates/animated-video.jpg',
    load: () => import('../../templates/animated-video.json')
  }
]

const TemplatesPanel = observer(function TemplatesPanel({
  store
}: {
  store: DesignStore
}): React.JSX.Element {
  return (
    <ImagesGrid<TemplateEntry>
      images={TEMPLATES}
      getPreview={(item) => item.preview}
      getAlt={(item) => item.name}
      rowsNumber={1}
      isLoading={false}
      onSelect={async (item) => {
        try {
          const { default: json } = await item.load()
          // Applying a template is a normal edit: it lands on the undo stack
          // and dirty-tracking/autosave picks it up.
          store.loadJSON(json)
          const tab = tabs.tabs.find((t) => t.store === store)
          if (tab && tab.name === 'Untitled') tab.name = item.name
        } catch (error) {
          console.error('Failed to load template', item.name, error)
          toast.error(`Could not load the "${item.name}" template.`)
        }
      }}
    />
  )
})

export const TemplatesSection: Section = {
  name: 'bundled-templates',
  Tab: ((props: { onClick: () => void; active: boolean }) => (
    <SectionTab name="Templates" {...props}>
      <LayoutTemplate className="size-4" />
    </SectionTab>
  )) as unknown as Section['Tab'],
  Panel: TemplatesPanel as unknown as Section['Panel']
}
