/// <reference types="electron-vite/node" />

// Build-time constants (electron.vite.config.ts `main.define`).
declare const __CLAUDE_CODE_VERSION__: string | undefined

interface ImportMetaEnv {
  // Build-time Sentry DSN (src/main/sentry.ts); unset = no crash reporting.
  readonly MAIN_VITE_SENTRY_DSN?: string
}
