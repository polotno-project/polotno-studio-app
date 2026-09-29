# Windows release

Goal: ship a signed Windows build that updates itself. Branch `nikigan/windows-release`, based on
master 78cffc4 (after PR #3 Windows support and PR #4 Linux testing).

Already done (see `.claude/windows-support/PROGRESS.md` on master): title bar, ☰ menu, `polotno`
CLI on PATH, save retries, path casing, full editor + export pass and NSIS install/uninstall on
Windows 11. v0.1.1 already publishes `polotno-app-<v>-setup.exe`, its blockmap and `latest.yml`.

## Phase 1 — Code signing (blocker: needs the Azure account)
Microsoft renamed Azure Trusted Signing to **Azure Artifact Signing** (docs:
learn.microsoft.com/azure/artifact-signing). Endpoints are unchanged (`https://<region>.codesigning.azure.net`),
and electron-builder 26 still drives it through the `TrustedSigning` PowerShell module (0.5.8, current).

- [ ] 1.1 Azure setup — needs a person with the Polotno Azure tenant. They must:
      1. Register the `Microsoft.CodeSigning` resource provider on the subscription.
      2. Create an Artifact Signing account (3–24 alphanumerics, globally unique) in a supported
         region; note the region's endpoint (e.g. East US `https://eus.codesigning.azure.net`,
         West Europe `https://weu.codesigning.azure.net`). Basic SKU is enough.
      3. Get the **Artifact Signing Identity Verifier** role, then submit a **Public** identity
         validation for the **Organization** (portal only; 1–20 business days; needs legal name,
         website, business ID, address, primary + secondary email on the company domain, and a
         representative who completes the ID check). Public Trust is only offered to orgs in the
         US, Canada, EU, UK, AU, NZ, JP, KR, SG, CH, NO, IL — confirm the legal entity qualifies.
      4. Create a **Public Trust** certificate profile (5–100 alphanumerics) from that validation;
         copy the **Certificate Subject Preview**.
      5. Create an Entra app registration + client secret; assign it **Artifact Signing
         Certificate Profile Signer** on the account (or the profile).
      Hand back (values, not screenshots):
      - endpoint URI, account name, certificate profile name
      - the exact certificate subject (DN), e.g. `CN=Polotno Inc, O=Polotno Inc, L=…, S=…, C=US`
      - repo secrets set by them: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
        (+ the secret's expiry date — put a reminder on it; an expired secret fails the release)
- [ ] 1.2 Repo secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
      (release.yml already passes them and unsets empty ones).
- [ ] 1.3 Config — prepared, left commented. The block lives in release.yml's package step
      (`sign_args`), NOT in electron-builder.yml: with `win.azureSignOptions` set, electron-builder
      always installs TrustedSigning and runs `Invoke-TrustedSigning`, so an unsigned build fails
      (checked: a macOS `--win` build with the option set dies with "cannot access pwsh").
      To enable: uncomment the `if … fi` block in release.yml and replace the four values
      (endpoint, codeSigningAccountName, certificateProfileName, publisherName = the exact DN).
      Option names checked against the installed 26.15.3 schema (`publisherName` is REQUIRED
      there — the old commented block lacked it). electron-builder 27 (alpha) moves this to
      `win.sign: { type: azure, … }` — re-check when upgrading.
      Verified: the `-c.win.azureSignOptions.*` overrides (DN with commas/`=`) reach the
      effective config intact (DEBUG=electron-builder), and the step's shell adds them only on
      the Windows runner with the secret present (tested all three branches in bash).
- [x] 1.4 PR/`build.yml` builds stay unsigned — enforced by the release.yml-only gating above.
- [ ] 1.5 Verify on a tag build: `Get-AuthenticodeSignature` on `Polotno.exe`, the installer,
      the uninstaller (`Uninstall Polotno.exe` in the install dir) and `resources\app.asar.unpacked`
      native binaries show Valid with the Polotno subject; SmartScreen shows the publisher instead
      of "Unknown publisher" (reputation may still warn for the first downloads).
- [ ] 1.6 `publisherName` ends up in the installed app's `resources\app-update.yml` (not in
      latest.yml — that's where electron-updater's NsisUpdater reads it). Check it's there and
      equals the DN. Every signed build then refuses updates signed under another name, so the
      DN must never change. 0.1.1 has no publisherName, so it accepts the first signed update.

## Phase 2 — Auto-update rehearsal (needs Phase 1 + the Windows test machine)
Recommended: rehearse against a local update feed so no rehearsal build reaches 0.1.1 users
(every published GitHub release is picked up by their updater). On the Windows 11 machine:
1. `az login` with an account that has the Signer role (TrustedSigning also accepts Azure CLI
   credentials), Node ≥ 22.12, repo checked out at the release commit, `npm ci`.
2. Set version to vN (e.g. 0.2.0-rc.1 — any semver above 0.1.1) and build:
   `npm run build && npx electron-builder --win --publish never -c.publish.provider=generic
   -c.publish.url=http://127.0.0.1:8080/ <the four -c.win.azureSignOptions.* args from release.yml>`
   Move `dist\*.exe`, `*.blockmap`, `latest.yml` to a `feed\` folder; serve it:
   `npx http-server feed -p 8080`.
3. Install vN (fresh Windows user). Bump to vN+1, rebuild the same way, add its files to `feed\`
   (overwrite latest.yml).
Then:
- [ ] 2.1 vN installs; `resources\app-update.yml` shows provider generic + publisherName. On
      arm64 hardware (if available) the one NSIS exe installs the arm64 app — check
      `Polotno.exe` in Task Manager → Details → Architecture.
- [ ] 2.2 Launch vN: "Polotno x.y.z is ready" (title bar "Polotno") within ~10 s.
      `%APPDATA%\polotno-app\logs\main.log` shows "Checking for update", "Found version",
      a differential download ("Download block maps" / "Full: …, To download: …"), and no
      signature error. `%LOCALAPPDATA%\polotno-app-updater\pending\` holds the installer.
- [ ] 2.3 Restart Now → relaunches on vN+1 (Apps & features version; Check for Updates says up to date); in a NEW
      terminal `polotno render` works and `reg query HKCU\Environment /v Path` has exactly one
      `…\resources\bin` entry; double-clicking a `.polotno` opens it; open tabs restored.
- [ ] 2.4 Reinstall vN; on the prompt pick Later, quit → update installs on quit; next launch is
      vN+1 and Check for Updates says "You are up to date (Polotno x.y.z)."
- [ ] 2.5b Negative check: build vN+2 UNSIGNED (no sign args), serve it → vN+1 must refuse it
      (log: "New version … is not signed by the application owner"). Proves publisherName works.
- [x] 2.5 Updater errors are only `console.error`ed — invisible in a packaged app. Add a file
      log (electron-log, or electron-updater's `logger`) so field failures are debuggable.
      Done: electron-log 5 (runtime dependency) as `autoUpdater.logger`, file level info;
      updater errors and failed interactive checks logged with stack. File:
      `%APPDATA%\polotno-app\logs\main.log` (mac: ~/Library/Logs/polotno-app/main.log,
      Linux: ~/.config/polotno-app/logs/main.log). Verified with a packaged mac --dir build:
      "Checking for update" + the (expected, no app-update.yml in a --dir build) error land in
      the file. Shared with Linux.
- [ ] 2.6 Update while a CLI `render` is running and while the app is busy exporting — no
      half-installed state (quitAndInstall while render.exe still runs: installer should wait
      or fail cleanly and retry on next quit; check main.log).
Afterwards: uninstall, delete `%LOCALAPPDATA%\polotno-app-updater`, and never publish the rc
builds — they only existed on the local feed.

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
- [x] 3.4 Installer UX check: Start menu + desktop shortcut names ("Polotno"), uninstaller
      display name, installer icon, per-user vs per-machine (currently per-user default —
      confirm that's intended).
      Config reviewed: Start menu + desktop shortcut and uninstall entry are all
      `${productName}` = "Polotno"; icon comes from build/icon.png (1024², converted to .ico).
      Per-user is intended and now explicit (`oneClick: true`, `perMachine: false` + comment):
      updates need no UAC, and cli-path.ps1 edits the HKCU PATH only. `electron-builder --win
      --x64` on macOS builds the installer (oneClick=true perMachine=false). Seeing the names
      and icon on screen → 4.2 smoke test.

## Phase 4 — Release (needs the user's go-ahead: tagging and publishing are outward-facing)
- [ ] 4.1 Bump `version` in package.json (+ lockfile root), commit on master, tag `vX.Y.Z`,
      push the tag → release.yml builds macOS/Windows/Linux into a DRAFT release. Check the
      Windows job log shows `signing with Azure Trusted Signing` for Polotno.exe, the uninstaller
      and the installer. Check that `VITE_POLOTNO_KEY` is set (otherwise the app shows the red
      "Polotno free license limitation exceeded" banner, as local builds do).
- [ ] 4.2 On the Windows machine, download the draft's `polotno-app-X.Y.Z-setup.exe`:
      `Get-AuthenticodeSignature` Valid; SmartScreen names the publisher; install; Start menu +
      desktop shortcut "Polotno", Apps & features entry "Polotno" with the app icon; open a
      design, export PNG and PDF (welcome template → vector PDF works), GIF, `polotno render` in
      a new terminal; a message box (Check for Updates) is titled "Polotno"; no license banner.
      Then publish the draft (go-live gate — the updater only sees published releases).
- [ ] 4.3 On a machine with 0.1.1 installed (unsigned): launch, wait ~10 s → update prompt,
      Restart Now → X.Y.Z, signed; main.log clean. Watch GitHub issues for the first days.

## Notes
- Signing needs org validation; start 1.1 first, everything else can proceed meanwhile.
- Test machine: Windows 11 Pro 26200 (used for the Windows support pass). Node ≥ 22.12.
- Playwright `_electron` needs `colorScheme: null` (see windows-support notes).
- E2E on macOS without touching the real profile: launch Electron on a wrapper dir whose
  main.cjs does `app.setPath('userData'|'documents', <tmp>)` then requires `out/main/index.js`
  (NODE_OPTIONS=--require is ignored). Used for the 2026-09-29 check: Export › PDF of the
  welcome template (223 KB, 2.8 s), Export › Animated GIF of animated-video (149 frames,
  1080×1920, 9 s), and message boxes from Check for Updates / dialog:confirm /
  dialog:externalChange all carry `title: "Polotno"` (captured by stubbing dialog in main).
