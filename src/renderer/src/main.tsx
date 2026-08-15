import React from 'react'
import ReactDOM from 'react-dom/client'
import { setAnimationsEnabled } from 'polotno/config'
import App from './App'
import { loadSystemLocaleTranslations } from './editor/i18n'
import { installThemeSync } from './editor/theme'
import './editor/bridge'
import './index.css'

setAnimationsEnabled(true)
installThemeSync()
loadSystemLocaleTranslations()

// Flattened PDF export ('pdf-flat') runs through jsPDF, which polotno
// otherwise pulls from a CDN with a <script> tag that has no error handler —
// on file:// the load never settles and the export hangs until it times out.
// This hook keeps it bundled, so it works offline and in the headless CLI.
;(window as unknown as { __polotnoLoadJspdf: () => Promise<unknown> }).__polotnoLoadJspdf = () =>
  import('jspdf')

// Console/driver handle, same spirit as studio's `window.store`.
void import('./editor/tabs-model').then(({ tabs }) => {
  void import('./editor/document').then((document) => {
    ;(window as unknown as { polotnoApp: unknown }).polotnoApp = { tabs, document }
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
