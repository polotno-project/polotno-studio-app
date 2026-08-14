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

- Done: private `polotno-project/polotno-studio-app`, code pushed, CI green
  on all 3 OSes, `v1.0.0` draft release built with all installers.
- Before real users: make the repo (or at least releases) public —
  electron-updater cannot read a private repo's releases without an embedded
  token, so auto-update only works once releases are public.

## 3. Code signing secrets (GitHub repo secrets)

macOS:

- `CSC_LINK` (Developer ID .p12, base64) and `CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Then set `mac.notarize: true` in `electron-builder.yml`.

Windows (Azure Trusted Signing):

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- Then uncomment and fill `win.azureSignOptions` in `electron-builder.yml`
  (endpoint, account name, certificate profile).

Linux AppImage stays unsigned by design.

## 4. First release rehearsal

- The `v1.0.0` draft exists (mac universal dmg+zip, win setup.exe, linux
  AppImage, blockmaps, updater manifests). Publishing the draft is the
  go-live gate.
- After publishing: install on all three OSes, then tag `v1.0.1` and confirm
  the installed app auto-updates (differential download in the updater log).
- With signing secrets in place, verify `spctl -a -v Polotno.app` on macOS.

## 5. Skills repo

- `polotno-ai-rules` has an unpushed local commit (`9d99923`,
  "polotno-design: add live MCP path for the Polotno desktop app").
  Review, push, or PR it.
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
