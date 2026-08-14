import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // @polotno/pdf-import does `import opentype from 'opentype.js'`, but the
        // package's ESM build only has named exports. The UMD build gets a
        // synthetic default from rollup's commonjs interop.
        'opentype.js': resolve('node_modules/opentype.js/dist/opentype.js')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
