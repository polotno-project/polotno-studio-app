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
- [x] 2.1 `desktopName: polotno.desktop` in package.json + `linux.syncDesktopName: true`: the deb
      installs /usr/share/applications/polotno.desktop with `StartupWMClass=polotno` (= Electron's
      app_id/WM_CLASS); the AppImage embeds the same polotno.desktop. The build warning is gone.
      Still verify on the VM, Wayland and X11 (4.x): dock icon + window grouping.
- [x] 2.2 deb target (`dist/polotno-app_<v>_amd64.deb`, package `polotno-app`, Section graphics).
      Finding: electron-builder 26's STOCK deb after-install/after-remove already do the AppArmor
      part: install `resources/apparmor-profile` (`userns`, flags=(unconfined), for
      /opt/Polotno/<executable>) to /etc/apparmor.d, load it with apparmor_parser, unload + delete it
      on remove, link /usr/bin/<executable> via update-alternatives, run update-mime-database /
      update-desktop-database. So no custom scripts: `linux.executableName: polotno` makes that
      /usr/bin/polotno (the CLI), /opt/Polotno/polotno and /etc/apparmor.d/polotno. The AppImage's
      inner binary is renamed too (AppRun `BIN="$APPDIR/polotno"`, render verified).
      `fileAssociations[].mimeType: application/x-polotno` → /usr/share/mime/packages/polotno.xml
      (glob *.polotno) + `MimeType=` in the .desktop.
      `deb.depends` = electron-builder defaults + `libasound2t64 | libasound2` (minimal 24.04 failed
      with missing libasound.so.2).
      electron-updater 6.8.9 updates deb installs: resources/package-type=deb → DebUpdater downloads
      the .deb from latest-linux.yml (lists AppImage + deb) and runs `dpkg -i` via pkexec/gksudo.
      Verified in an amd64 ubuntu:24.04 container: apt install, /usr/bin/polotno → /opt/Polotno/polotno,
      globs2 + mimeinfo.cache entries, CLI render (500 KB PNG), apt remove cleans up. AppArmor itself
      can't run in a container → CI (2.3) and VM.
      **Blocker before release: `deb.maintainer` is a placeholder (TODO-maintainer@polotno.com) —
      needs the real contact address from the user.**
- [x] 2.3 CI: build.yml "deb smoke test" installs the deb with apt, keeps the userns restriction ON
      (so a successful render proves the AppArmor profile gives Chromium its sandbox), checks the
      /usr/bin link, aa-status, MIME registration, CLI exit code 2 on no inputs, and removal. Unpacked
      smoke test path → dist/linux-unpacked/polotno; artifact now includes dist/*.deb.
      Not run yet — needs a push (ask the user).
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
