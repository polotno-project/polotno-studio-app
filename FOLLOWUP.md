# Follow-up actions

Owner actions needed before launch. The code for all of these is already in
place — each item is an account, credential, or publish step only you can do.

## 1. Polotno license key

- Done locally: the key lives in `.env` (`VITE_POLOTNO_KEY`, gitignored).
- Make sure the domains `electron` (packaged app, file://) and `localhost`
  (dev) are allowed for the key at https://polotno.com/cabinet.
- Add the key as the `VITE_POLOTNO_KEY` GitHub secret — the CI workflows
  already pass it to builds.

## 2. GitHub repository

- Done: public `polotno-project/polotno-studio-app`, code pushed, CI green
  on all 3 OSes, `v0.1.0` release published with all installers — the
  auto-updater can see it.

## 3. Code signing secrets (GitHub repo secrets)

macOS:

- Done: `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/
  `APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` secrets set,
  `mac.notarize: true` — CI builds are signed and notarized.

Windows (Azure Trusted Signing):

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- Then uncomment and fill `win.azureSignOptions` in `electron-builder.yml`
  (endpoint, account name, certificate profile).

Linux AppImage stays unsigned by design.

## 4. First release rehearsal

- Done: `v0.1.0` published (mac universal dmg+zip signed+notarized, win
  setup.exe, linux AppImage, blockmaps, updater manifests); `spctl` verified
  on macOS.
- Remaining: install `v0.1.0`, then tag `v0.1.1` and confirm the installed
  app auto-updates (differential download in the updater log).

## 5. Skills repo

- Done: `polotno-ai-rules` commit `9d99923` ("polotno-design: add live MCP
  path for the Polotno desktop app") is pushed to origin.
- If the skill changes after that, bump `SKILL_COMMIT` in
  `scripts/sync-skills.mjs`, re-run it, and commit `vendor/skills`.

## 6. Manual connect checks (need real client apps)

- Claude Desktop: install the `.mcpb` from the Connect panel, run the
  60-second demo ("make me 5 Instagram posts").
- Cursor and VS Code: verify the deeplinks register the server.
- Claude Code: paste the copied command and confirm the tools list.

## Smaller code follow-ups (optional, no account access needed)

- Tune the `text-overflow` lint check against real designs (it over-reports
  on some templates).
- Windows/Linux pass: the frameless title bar (`titleBarOverlay`) and file
  watcher are untested outside macOS.
- "My designs" panel: add saved thumbnails for file-backed designs that are
  not open (sidecar previews, like the studio).
- Consider an upload/assets section (`setUploadFunc` with data URLs is
  wired conceptually but no UI section exists yet).
- True offline mode (much later, by decision): re-enable the bundled
  font/template fallbacks. The assets stay in the repo
  (`scripts/fetch-fonts.mjs`, `src/renderer/public/fonts`,
  `src/renderer/src/templates`); the removed wiring is in git history.
