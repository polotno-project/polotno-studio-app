# Windows release

Goal: ship a signed Windows build that updates itself. Branch `nikigan/windows-release`, based on
master 78cffc4 (after PR #3 Windows support and PR #4 Linux testing).

Already done (see `.claude/windows-support/PROGRESS.md` on master): title bar, ☰ menu, `polotno`
CLI on PATH, save retries, path casing, full editor + export pass and NSIS install/uninstall on
Windows 11. v0.1.1 already publishes `polotno-app-<v>-setup.exe`, its blockmap and `latest.yml`.

## Phase 1 — Code signing (blocker: needs the Azure account)
- [ ] 1.1 Azure Trusted Signing: account, identity validation (organization — takes days), a
      certificate profile, and an app registration with the "Trusted Signing Certificate Profile
      Signer" role. Owner: whoever holds the Polotno Azure tenant.
- [ ] 1.2 Repo secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
      (release.yml already passes them and unsets empty ones).
- [ ] 1.3 Uncomment `win.azureSignOptions` in electron-builder.yml; fill the real endpoint
      (region), `codeSigningAccountName`, `certificateProfileName`. Check the current
      electron-builder docs for the option names first — they changed across v25/v26.
- [ ] 1.4 Decide: should PR/`build.yml` builds stay unsigned? (yes — secrets aren't available to
      forks; only release.yml signs).
- [ ] 1.5 Verify on a tag build: `Get-AuthenticodeSignature` on `Polotno.exe`, the installer,
      and the uninstaller all show Valid with the Polotno
      publisher; SmartScreen shows the publisher instead of "Unknown publisher".
- [ ] 1.6 `latest.yml` carries `publisherName` so electron-updater verifies the signature of
      downloaded updates (it refuses an update signed by a different publisher — keep the name
      stable).

## Phase 2 — Auto-update rehearsal (needs Phase 1)
- [ ] 2.1 Publish signed vN (e.g. 0.2.0) and install it on the Windows 11 test machine
      (fresh user, then an x64 and, if available, an arm64 machine — the NSIS installer bundles
      both arches, so check the updater downloads/installs the right one).
- [ ] 2.2 Publish vN+1; launched app shows "Polotno x.y.z is ready" within ~10 s. Check
      `%LOCALAPPDATA%\polotno-app-updater\` and the log (`%APPDATA%\polotno-app\logs`, or
      wire `electron-log` if nothing is logged — see 2.5) for a differential (blockmap) download.
- [ ] 2.3 Restart Now → app relaunches on vN+1; `polotno` CLI on PATH still works (PATH entry
      survives the silent reinstall, not duplicated); `.polotno` association intact; open
      documents/session restored.
- [ ] 2.4 Later + quit → installs on quit; the Check for Updates menu item reports "up to date".
- [x] 2.5 Updater errors are only `console.error`ed — invisible in a packaged app. Add a file
      log (electron-log, or electron-updater's `logger`) so field failures are debuggable.
      Done: electron-log 5 (runtime dependency) as `autoUpdater.logger`, file level info;
      updater errors and failed interactive checks logged with stack. File:
      `%APPDATA%\polotno-app\logs\main.log` (mac: ~/Library/Logs/polotno-app/main.log,
      Linux: ~/.config/polotno-app/logs/main.log). Verified with a packaged mac --dir build:
      "Checking for update" + the (expected, no app-update.yml in a --dir build) error land in
      the file. Shared with Linux.
- [ ] 2.6 Update while a CLI `render` is running and while the app is busy exporting — no
      half-installed state.

## Phase 3 — Polish (can go in parallel with Phase 1)
- [x] 3.1 Dialog titles: message boxes show "polotno-app" (app.name). Pass `title: 'Polotno'`
      in src/main/ipc.ts (`dialog:confirm`, `dialog:externalChange`), src/main/updater.ts
      (all four), src/main/menu.ts. Don't change app.name (userData path).
      Done: `title: 'Polotno'` on all 7 message boxes (open/save file dialogs keep Windows'
      own "Open"/"Save As"). typecheck + build pass. macOS ignores message-box titles, so the
      visible check is on Windows (add to the 4.2 smoke test).
- [x] 3.2 Node requirement: `engines.node >=22.12` in package.json + `.nvmrc` (npm ci's
      postinstall fails on 20.9 with only EBADENGINE warnings). Shared with Linux — do it once.
      Done: engines in package.json (+ lockfile root entry), `.nvmrc` = 22, build.yml and
      release.yml read `node-version-file: .nvmrc`, README states the requirement.
- [x] 3.3 Vector PDF of the welcome template fails on Windows/Linux ("Monaco" font →
      FONT_FAILED). Locate the template (not in src/ — likely vendor skills or remote templates),
      switch to Cousine/Courier Prime. Shared with Linux.
      Done: the template is src/renderer/src/templates/welcome.json after all; it never names
      Monaco. Its `quill-ql-classes` text uses `class="ql-font-monospace"`, which
      @polotno/core maps to "Monaco, Courier New, monospace"; pdf-export takes the first family,
      Google Fonts answers 400 → FONT_FAILED on every OS (reproduced on macOS). Georgia is fine
      (Google serves it). Swapped that span to inline `'Courier New', monospace` (base-14
      Courier, no network), matching the template's other mono spans. `polotno render
      welcome.json -o x.pdf` now writes 4 pages, text extracts, mono runs are /Courier.
      Upstream issue (any design with ql-font-monospace) → BACKLOG.md.
- [ ] 3.4 Installer UX check: Start menu + desktop shortcut names ("Polotno"), uninstaller
      display name, installer icon, per-user vs per-machine (currently per-user default —
      confirm that's intended).

## Phase 4 — Release
- [ ] 4.1 Bump version, tag `v*`, let release.yml build all three OSes into the draft release.
- [ ] 4.2 Download the draft's setup.exe on Windows, install, smoke test (open, export PNG,
      CLI render), then publish the draft (the go-live gate — updater only sees published).
- [ ] 4.3 Watch the first real update from the previous public version.

## Notes
- Signing needs org validation; start 1.1 first, everything else can proceed meanwhile.
- Test machine: Windows 11 Pro 26200 (used for the Windows support pass). Node ≥ 22.12.
- Playwright `_electron` needs `colorScheme: null` (see windows-support notes).
