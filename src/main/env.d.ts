/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  // Build-time Sentry DSN (src/main/sentry.ts); unset = no crash reporting.
  readonly MAIN_VITE_SENTRY_DSN?: string
}
