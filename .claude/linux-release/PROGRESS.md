# Linux release

Goal: a Linux build people can install, launch from the app menu, and that updates itself.
Branch `nikigan/linux-release`, based on master 78cffc4 (after PR #4 Linux testing).

Already done (see `.claude/linux-testing/PROGRESS.md` and docs/linux-testing.md on master):
AppImage runs on stock Ubuntu 24.04.5 (Wayland), ☰ menu, dialogs, all nine export formats, editor
pass, CLI render/lint (incl. the AppRun `--no-sandbox` fix), MCP discovery via `$APPIMAGE`.
v0.1.1 already publishes `polotno-app-<v>.AppImage` and `latest-linux.yml`.
Test VM: Proxmox VM 108, snapshot `clean-install` (roll back before each round).

## Phase 1 — Decisions (need the user / product)
- [ ] 1.1 Sandbox: on stock 24.04 the AppImage runs without the Chromium sandbox (AppRun adds
      `--no-sandbox` when `unshare -Ur true` fails). Pick one:
      a) accept it (most Electron AppImages do) and document it;
      b) ship a `.deb` that installs an AppArmor `userns` profile for /opt/Polotno/polotno-app,
         so deb users get the sandbox; AppImage stays as-is;
      c) custom AppRun that warns. Recommendation: (b) together with 1.2.
- [ ] 1.2 Packages: add `deb` (and maybe `rpm`) next to AppImage? Without one there's no .desktop
      entry → no app-menu launcher, no `.polotno` association (unless AppImageLauncher/Gear
      Lever). Note: electron-updater only self-updates AppImage (and deb/rpm via a
      privileged package-manager prompt in newer versions — check current docs).
- [ ] 1.3 arm64 Linux build? Currently x64 only; artifactName has no arch, so adding arm64
      needs `${arch}` in `appImage.artifactName`.

## Phase 2 — Packaging fixes
- [ ] 2.1 `desktopName` in package.json + `linux.syncDesktopName: true` so WM_CLASS/app_id
      matches the .desktop file (dock icon + window grouping). Verify on Wayland and X11.
- [ ] 2.2 If deb chosen: `linux.target: [AppImage, deb]`, maintainer/vendor/synopsis fields,
      AppArmor profile via `deb.afterInstall` (and removal in afterRemove), `polotno` CLI symlink
      in /usr/bin, MIME type for `.polotno`. Check electron-builder docs for current option names.
- [ ] 2.3 CI: build.yml smoke-tests the deb too (`dpkg -i`, run CLI render under xvfb).
- [ ] 2.4 Node requirement `engines` + `.nvmrc` (shared with Windows — do once).

## Phase 3 — Editor polish
- [ ] 3.1 GIF export progress: ~25 s with nothing on screen. `exportGIF` in
      src/renderer/src/editor/export.ts has no `onProgress`; give it the same progress toast as
      MP4 (check `store.saveAsGIF` options in current Polotno docs).
- [ ] 3.2 Vector PDF of the welcome template fails ("Monaco" → FONT_FAILED). Shared with Windows.
- [ ] 3.3 Dialog titles "polotno-app" → explicit `title: 'Polotno'` (shared with Windows).

## Phase 4 — Remaining manual checks (VM 108, by hand)
- [ ] 4.1 Resize with transformer handles; drag-and-drop from side panel to canvas.
- [ ] 4.2 Clipboard: copy/paste text and images, in-app and from other apps.
- [ ] 4.3 HiDPI: 200% and fractional (125%/150%) scaling — canvas sharpness, title bar.
- [ ] 4.4 X11 session ("Ubuntu on Xorg"): window, menu, Alt shows the menu bar, dialogs.
- [ ] 4.5 Second instance: launching again focuses the first; opening a `.polotno` file adds
      a tab to the running app.
- [ ] 4.6 Other distros smoke test: Fedora (GNOME, libfuse differences), maybe KDE.

## Phase 5 — Auto-update rehearsal
Procedure in docs/linux-testing.md › Auto-update.
- [ ] 5.1 Put an older AppImage in ~/ (v0.1.0 asset), launch → update dialog.
- [ ] 5.2 Restart Now → same path holds the new version; `mcp.json` `appVersion` and
      `execPath` updated; CLI still works.
- [ ] 5.3 Later + quit → installs on quit.
- [ ] 5.4 AppImage in a read-only / root-owned dir → updater fails gracefully (log it).
- [ ] 5.5 If deb shipped: update path for deb users.
- [ ] 5.6 Updater errors are only console.error'd — add a file log (shared with Windows 2.5).

## Phase 6 — Release
- [ ] 6.1 Tag, draft release from release.yml, download the draft AppImage (and deb) onto a
      clean VM (rollback to clean-install), smoke test, publish.
- [ ] 6.2 Document install steps for users (libfuse2t64 on 24.04, chmod +x, sandbox note).
