import * as Sentry from '@sentry/electron/renderer'

// Imported first by main.tsx so errors thrown while the rest of the app's
// modules evaluate are caught too. No DSN here: events go to the main process
// over IPC (preload), which owns the config and drops them in builds without one.
Sentry.init()
