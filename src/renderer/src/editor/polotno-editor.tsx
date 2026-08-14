import { useCallback } from 'react'
import type { DragEvent } from 'react'
import { observer } from 'mobx-react-lite'
import { PolotnoContainer, SidePanelWrap, WorkspaceWrap } from 'polotno'
import { Workspace } from 'polotno/canvas/workspace'
import { PagesTimeline } from 'polotno/pages-timeline'
import { DEFAULT_SECTIONS, SidePanel, type Section } from 'polotno/side-panel'
import { Toolbar } from 'polotno/toolbar/toolbar'
import { ZoomButtons } from 'polotno/toolbar/zoom-buttons'

import 'polotno/ui.css'

import type { DesignStore } from './store'

// The bundled Templates section replaces the network one in a later step;
// the stock upload section needs an upload backend, so it is out for now.
const SECTIONS = DEFAULT_SECTIONS.filter(
  (section) => !['templates', 'upload'].includes(section.name)
) as Section[]

export const PolotnoEditor = observer(function PolotnoEditor({
  store
}: {
  store: DesignStore
}): React.JSX.Element {
  const onGlobalDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }, [])

  // File drops are wired to the import pipeline in the file-IO step.
  const onGlobalDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    const dt = e.dataTransfer
    // Skip in-app element drags (side panel -> canvas): those carry items but
    // no OS files. Only intercept real file drops.
    if (dt.files.length === 0 || dt.files.length !== dt.items.length) return
    e.preventDefault()
  }, [])

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
