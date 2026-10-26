import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { version } from './package.json'

// Source maps go to Sentry only when CI provides SENTRY_AUTH_TOKEN (plus
// SENTRY_ORG / SENTRY_PROJECT, read by the plugin from the environment). They
// are 'hidden' (no sourceMappingURL) and deleted after upload, so none ship.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)
const sentry = uploadSourceMaps
  ? sentryVitePlugin({
      // Same release as Sentry.init in src/main/sentry.ts.
      release: { name: `polotno-app@${version}` },
      sourcemaps: { filesToDeleteAfterUpload: ['out/**/*.map'] },
      telemetry: false
    })
  : []
const sourcemap = uploadSourceMaps ? ('hidden' as const) : false

// The Claude Code version the bundled Agent SDK was released with (its
// package exports don't include package.json): the Claude provider names it
// when the user's CLI fails to start.
const claudeCodeVersion: string | undefined = JSON.parse(
  readFileSync(resolve('node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')
).claudeCodeVersion

export default defineConfig({
  main: {
    build: { sourcemap },
    define: { __CLAUDE_CODE_VERSION__: JSON.stringify(claudeCodeVersion) },
    plugins: [sentry]
  },
  preload: {
    build: {
      sourcemap,
      // index: the editor window. background-host: the hidden background
      // removal page (src/main/background-host.ts). They share no module, so
      // each still builds to one file, as sandboxed preloads must.
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'background-host': resolve('src/preload/background-host.ts')
        }
      },
      // The window is sandboxed: its preload can't require() from
      // node_modules, so the Sentry IPC bridge must be bundled in.
      externalizeDeps: { exclude: ['@sentry/electron'] }
    },
    plugins: [sentry]
  },
  renderer: {
    build: {
      sourcemap,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'background-host': resolve('src/renderer/background-host.html')
        }
      }
    },
    // The background removal worker loads onnxruntime-web, which code-splits.
    worker: { format: 'es' },
    // Pre-bundling breaks onnxruntime-web's new URL(…, import.meta.url) for
    // its .wasm file.
    optimizeDeps: { exclude: ['onnxruntime-web'] },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        // @polotno/pdf-import does `import opentype from 'opentype.js'`, but the
        // package's ESM build only has named exports. The UMD build gets a
        // synthetic default from rollup's commonjs interop.
        'opentype.js': resolve('node_modules/opentype.js/dist/opentype.js')
      }
    },
    plugins: [react(), tailwindcss(), sentry]
  }
})
