import { useState } from 'react'
import { PolotnoEditor } from './editor/polotno-editor'
import { createDesignStore } from './editor/store'

export default function App(): React.JSX.Element {
  const [store] = useState(createDesignStore)
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <PolotnoEditor store={store} />
      </div>
    </div>
  )
}
