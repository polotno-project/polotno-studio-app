# Sentry integration

Goal: crash/error reporting via Sentry. User decisions: always on (no opt-out toggle), errors + native crashes only (no tracing/replay), source maps uploaded from the Release workflow.

- [x] `@sentry/electron` 8.3 (dependency) + `@sentry/vite-plugin` 11.8 (dev)
- [x] Main: src/main/sentry.ts `initSentry()` — DSN from build-time `MAIN_VITE_SENTRY_DSN`, no DSN = no-op; release `polotno-app@<version>`; called in the GUI branch of src/main/index.ts and in runCli right after the isolated userData is set (SDK caches under userData)
- [x] CLI: unexpected (non-CliError) failures are captured + flushed before app.exit
- [x] Preload imports `@sentry/electron/preload`; electron.vite.config.ts excludes it from externalizeDeps (sandboxed preload can't require node_modules)
- [x] Renderer: src/renderer/src/sentry.ts imported first in main.tsx
- [x] Source maps: plugin + `sourcemap: 'hidden'` only when SENTRY_AUTH_TOKEN is set; maps deleted after upload; upload failure doesn't fail the build
- [x] release.yml passes secrets SENTRY_DSN / SENTRY_AUTH_TOKEN and vars SENTRY_ORG / SENTRY_PROJECT; README documents it
- [x] Verified against a local envelope-capture server (DSN http://key@127.0.0.1:8999/1, app with --user-data-dir): renderer error, renderer unhandled rejection, main unhandled rejection, native renderer crash (Page.crash → fatal minidump event), all with release polotno-app@0.1.4. No screenshots/local variables attached (SDK defaults off). CLI render still exits 0.
- [x] Sentry project polotno/polotno-studio-app (platform electron) created via MCP; real renderer error verified in Sentry (POLOTNO-STUDIO-APP-2)
- [x] No user IP/geo: `dataCollection: { userInfo: false }` in main (verified: POLOTNO-STUDIO-APP-3 has 0 users)
- [x] GitHub: secret SENTRY_DSN, variables SENTRY_ORG=polotno / SENTRY_PROJECT=polotno-studio-app set via gh
- [x] SENTRY_AUTH_TOKEN secret (org auth token, created in Sentry UI) — needed for source-map upload in release.yml
- [ ] Verify on the first tagged release: source-map upload succeeds (no 401/403 in the build log) and a production event's frames show original source
- [x] PR opened: https://github.com/polotno-project/polotno-studio-app/pull/9
- [x] CI fix: macOS universal packaging failed — @sentry/node lists @sentry/bundler-plugins (build-time only) as a dependency, so oxc-parser's arm64-only .node binary (+ Babel, the 15 MB sentry CLI) shipped in the app. Moved @sentry/electron to devDependencies so electron-vite bundles it into out/main (repo convention); nothing from @sentry ships in node_modules. Re-verified main/renderer/native-crash events with the bundled SDK, `electron-builder --mac --universal --dir`, packaged CLI render.
- [x] Merged master (agents integration, Linux/Windows release work): combined env.d.ts, main define + Sentry plugin, release.yml env + Linux packaging step; lockfile = master's + npm install. Re-verified typecheck, npm test (17), events end to end, universal mac packaging
