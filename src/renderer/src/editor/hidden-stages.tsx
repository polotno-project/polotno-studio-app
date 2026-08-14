import { observer } from 'mobx-react-lite'
import { WorkspaceCanvas } from 'polotno/canvas/workspace-canvas'
import { tabs } from './tabs-model'

const NULL_COMPONENTS = {
  PageControls: () => null,
  Tooltip: () => null
}

// Background tabs get a bare off-screen WorkspaceCanvas (the polotno-node
// client-page pattern): store.toDataURL/export need a mounted Konva stage,
// and text elements only measure their real height when rendered. The active
// tab is excluded — the visible editor owns its stage.
export const HiddenStages = observer(function HiddenStages(): React.JSX.Element {
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -10000,
        top: 0,
        width: 800,
        height: 800,
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      {tabs.tabs
        .filter((tab) => tab.docId !== tabs.activeDocId)
        .map((tab) => (
          <div key={tab.docId} style={{ width: 800, height: 800 }}>
            <WorkspaceCanvas
              store={tab.store}
              visiblePagesOffset={0}
              renderOnlyActivePage
              components={NULL_COMPONENTS}
            />
          </div>
        ))}
    </div>
  )
})
