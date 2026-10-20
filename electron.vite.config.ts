import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The Claude Code version the bundled Agent SDK was released with (its
// package exports don't include package.json): the Claude provider names it
// when the user's CLI fails to start.
const claudeCodeVersion: string | undefined = JSON.parse(
  readFileSync(resolve('node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')
).claudeCodeVersion

export default defineConfig({
  main: {
    define: { __CLAUDE_CODE_VERSION__: JSON.stringify(claudeCodeVersion) }
  },
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
