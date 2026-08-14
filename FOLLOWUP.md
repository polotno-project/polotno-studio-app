# Follow-up actions

Owner actions needed before launch. The code for all of these is already in
place — each item is an account, credential, or publish step only you can do.

## 1. Polotno license key

- In https://polotno.com/cabinet, add the domain `electron` to the key you
  will ship (the packaged app runs on `file://`, which the SDK reports as
  origin `electron`).
- Build with the key: set `VITE_POLOTNO_KEY` (env or `.env`).
- Until this is done, every canvas, agent render, and export carries the red
  trial banner.
- After the key works, regenerate the template previews (they contain the
  banner now): `npm run build && node scripts/build-template-previews.mjs`,
  then commit the changed JPEGs.

## 2. GitHub repository

- Create `polotno-project/polotno-studio-app` (or another name — then update
  `publish.owner` / `publish.repo` in `electron-builder.yml`).
- Add the remote and push `master`.
- CI starts working on push: `build.yml` runs on PRs, `release.yml` on `v*`
  tags.

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

- Tag `v1.0.0`, let CI build, publish the draft release.
- Install the app from that release on all three OSes.
- Tag `v1.0.1`, publish, and confirm the installed app auto-updates (check
  the updater log for a differential download).
- Verify `spctl -a -v Polotno.app` passes on macOS.

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
