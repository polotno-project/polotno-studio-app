import React from 'react'
import ReactDOM from 'react-dom/client'
import { setAnimationsEnabled } from 'polotno/config'
import App from './App'
import { loadSystemLocaleTranslations } from './editor/i18n'
import { installThemeSync } from './editor/theme'
import './index.css'

setAnimationsEnabled(true)
installThemeSync()
loadSystemLocaleTranslations()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
