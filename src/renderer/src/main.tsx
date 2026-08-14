import React from 'react'
import ReactDOM from 'react-dom/client'
import { setAnimationsEnabled } from 'polotno/config'
import App from './App'
import { loadSystemLocaleTranslations } from './editor/i18n'
import { installThemeSync } from './editor/theme'
import { installOfflineFonts } from './editor/offline-fonts'
import './editor/bridge'
import './index.css'

setAnimationsEnabled(true)
installThemeSync()
installOfflineFonts()
loadSystemLocaleTranslations()

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
