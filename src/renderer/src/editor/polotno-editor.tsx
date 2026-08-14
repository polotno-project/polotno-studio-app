import { useCallback } from 'react'
import type { DragEvent } from 'react'
import { observer } from 'mobx-react-lite'
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno'
import { Workspace } from 'polotno/canvas/workspace'
import { PagesTimeline } from 'polotno/pages-timeline'
import { DEFAULT_SECTIONS, SidePanel, type Section } from 'polotno/side-panel'
import { Toolbar } from 'polotno/toolbar/toolbar'
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons'
import { selectImage } from 'polotno/side-panel/select-image'
import { toast } from 'sonner'

import 'polotno/ui.css'

import type { DesignStore } from './store'
import { designFileKind, parseDesignFile } from './import-design'
import { tabs, nameFromPath } from './tabs-model'
import { TemplatesSection } from './sections/templates-section'
import { withNetworkGate } from './sections/network-gate'

// Bundled Templates section replaces the api.polotno.com one; the stock upload
// section needs an upload backend, so it is out for now. Network-dependent
// stock sections stay, gated with an offline notice.
const NETWORK_SECTIONS = ['photos', 'elements', 'videos']
const SECTIONS = [
  TemplatesSection,
  ...DEFAULT_SECTIONS.filter((section) => !['templates', 'upload'].includes(section.name)).map(
    (section) => (NETWORK_SECTIONS.includes(section.name) ? withNetworkGate(section) : section)
  )
] as Section[]

export const PolotnoEditor = observer(function PolotnoEditor({
  store
}: {
  store: DesignStore
}): React.JSX.Element {
  const onGlobalDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }, [])

  const onGlobalDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      const dt = e.dataTransfer
      // Skip in-app element drags (side panel -> canvas): those carry items but
      // no OS files. Only intercept real file drops.
      if (dt.files.length === 0 || dt.files.length !== dt.items.length) return
      e.preventDefault()
      const files = Array.from(dt.files)

      // A single dropped design file (.json/.polotno/.pdf/.ai/.svg) opens as a
      // new tab; anything else image-like is placed into the current design.
      if (files.length === 1 && designFileKind(files[0]) !== null) {
        const file = files[0]
        void parseDesignFile(file)
          .then((json) => {
            if (!json) return
            // Dropped Files expose no filesystem path in a sandboxed renderer,
            // so the tab opens untitled; Save As re-binds it to a path.
            tabs.newTab({ json, name: nameFromPath(file.name) })
          })
          .catch((error) => {
            console.error('Failed to import dropped file', error)
            toast.error(`Could not import ${file.name} — not a valid design file.`)
          })
        return
      }

      for (const file of files) {
        if (!file.type.startsWith('image/')) continue
        const reader = new FileReader()
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            void selectImage({ src: reader.result, store })
          }
        }
        reader.readAsDataURL(file)
      }
    },
    [store]
  )

  return (
    <div className="h-full w-full" onDragOver={onGlobalDragOver} onDrop={onGlobalDrop}>
      <PolotnoContainer style={{ width: '100%', height: '100%' }}>
        <SidePanelWrap>
          <SidePanel store={store} sections={SECTIONS} />
        </SidePanelWrap>
        <WorkspaceWrap>
          <Toolbar store={store} />
          <Workspace store={store} />
          <ZoomButtons store={store} />
          <PagesTimeline store={store} />
        </WorkspaceWrap>
      </PolotnoContainer>
    </div>
  )
})
