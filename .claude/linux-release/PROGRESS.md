# Linux release

Goal: a Linux build people can install, launch from the app menu, and that updates itself.
Branch `nikigan/linux-release`, based on master 78cffc4 (after PR #4 Linux testing).

Already done (see `.claude/linux-testing/PROGRESS.md` and docs/linux-testing.md on master):
AppImage runs on stock Ubuntu 24.04.5 (Wayland), ☰ menu, dialogs, all nine export formats, editor
pass, CLI render/lint (incl. the AppRun `--no-sandbox` fix), MCP discovery via `$APPIMAGE`.
v0.1.1 already publishes `polotno-app-<v>.AppImage` and `latest-linux.yml`.
Test VM: Proxmox VM 108, snapshot `clean-install` (roll back before each round).

## Phase 1 — Decisions (made by the user, 2026-09-29)
- [x] 1.1 Sandbox → (b): ship a `.deb` that installs an AppArmor `userns` profile for
      /opt/Polotno/polotno-app, so deb users keep the Chromium sandbox. The AppImage stays as-is
      (runs with `--no-sandbox` on stock 24.04); document that limitation.
- [x] 1.2 Packages → add `deb` next to AppImage. No rpm for now (BACKLOG.md follow-up).
- [x] 1.3 arm64 Linux → not now (BACKLOG.md follow-up; needs `${arch}` in `appImage.artifactName`).

Ownership: the windows-release workspace owns the shared items (2.4 Node engines/.nvmrc,
3.2 Monaco font in the welcome template, 3.3 dialog titles, 5.6 updater file log). They are
skipped here to avoid merge conflicts and marked "done in windows-release".

## Phase 2 — Packaging fixes
- [ ] 2.1 `desktopName` in package.json + `linux.syncDesktopName: true` so WM_CLASS/app_id
      matches the .desktop file (dock icon + window grouping). Verify on Wayland and X11.
- [ ] 2.2 If deb chosen: `linux.target: [AppImage, deb]`, maintainer/vendor/synopsis fields,
      AppArmor profile via `deb.afterInstall` (and removal in afterRemove), `polotno` CLI symlink
      in /usr/bin, MIME type for `.polotno`. Check electron-builder docs for current option names.
- [ ] 2.3 CI: build.yml smoke-tests the deb too (`dpkg -i`, run CLI render under xvfb).
- [x] 2.4 Node requirement `engines` + `.nvmrc` — done in windows-release.

## Phase 3 — Editor polish
- [x] 3.1 GIF export progress: `store.saveAsGIF` has no `onProgress` (Polotno 4.14.1 types + docs),
      so `exportGIF` swaps `window.GIF` for a subclass during the export: `addFrame` counts
      captured frames ("Rendering GIF… n%"), gif.js 'progress' events cover encoding
      ("Encoding GIF… n%"). Verified in a throwaway Electron harness (Workspace mounted, 45 frames,
      both phases reach 100%, window.GIF restored, GIF saved). Still eyeball it in the app/VM.
- [x] 3.2 Vector PDF of the welcome template fails ("Monaco" → FONT_FAILED) — done in windows-release.
- [x] 3.3 Dialog titles "polotno-app" → explicit `title: 'Polotno'` — done in windows-release.

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
- [x] 5.6 Updater errors are only console.error'd — file log done in windows-release.

## Phase 6 — Release
- [ ] 6.1 Tag, draft release from release.yml, download the draft AppImage (and deb) onto a
      clean VM (rollback to clean-install), smoke test, publish.
- [ ] 6.2 Document install steps for users (libfuse2t64 on 24.04, chmod +x, sandbox note).
