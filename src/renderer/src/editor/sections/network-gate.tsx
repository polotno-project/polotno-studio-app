import { useEffect, useState, type ComponentType } from 'react'
import type { Section } from 'polotno/side-panel'

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const goOnline = (): void => setOnline(true)
    const goOffline = (): void => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])
  return online
}

// Wraps a stock section whose panel needs the network (stock photos, elements,
// videos). Offline, the panel is replaced with a friendly notice; the section
// itself stays visible so the app looks the same offline.
export function withNetworkGate(section: Section): Section {
  const Original = section.Panel as ComponentType<Record<string, unknown>>
  function GatedPanel(props: Record<string, unknown>): React.JSX.Element {
    const online = useOnline()
    if (!online) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-neutral-500">
          <p>This section needs an internet connection.</p>
          <p>Your designs and bundled fonts and templates keep working offline.</p>
        </div>
      )
    }
    return <Original {...props} />
  }
  return { ...section, Panel: GatedPanel as Section['Panel'] }
}
