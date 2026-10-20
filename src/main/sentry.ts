import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'

// Error and native-crash reporting for every process. Renderer and preload
// events travel over IPC to this instance, so only main knows the DSN. A build
// without MAIN_VITE_SENTRY_DSN (local/dev) reports nothing.
//
// Must run before app 'ready', and after any app.setPath('userData', …): the
// SDK queues events and minidumps under userData between restarts.
export function initSentry(): void {
  const dsn = import.meta.env.MAIN_VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    // Matches the release the vite plugin uploads source maps to
    // (electron.vite.config.ts).
    release: `polotno-app@${app.getVersion()}`,
    environment: app.isPackaged ? 'production' : 'development',
    // No user IP/geo: main's setting covers events from every process.
    dataCollection: { userInfo: false }
  })
}
