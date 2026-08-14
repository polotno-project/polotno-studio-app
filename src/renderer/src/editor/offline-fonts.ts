import { setGoogleFonts, replaceGlobalFonts, type FONT } from 'polotno/utils/fonts'
import manifest from '../fonts-manifest.json'

// Bundled fonts make the font picker fully local. Non-bundled Google fonts in
// opened designs still load from the network when online; offline they fall
// back to a system font.
export function installOfflineFonts(): void {
  replaceGlobalFonts(manifest as FONT[])
  setGoogleFonts([])
}
