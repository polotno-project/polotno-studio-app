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
- [x] 2.1 `desktopName: polotno-app.desktop` in package.json + `linux.syncDesktopName: true`: the deb
      installs /usr/share/applications/polotno-app.desktop with `StartupWMClass=polotno-app`; the
      AppImage embeds the same entry. Build warning gone. First tried `polotno.desktop`: on the VM
      Wayland app_id became "polotno" but X11 WM_CLASS stayed "polotno-app" (Electron takes WM_CLASS
      from app.name = package name, app_id from desktopName) → X11 wouldn't group. With
      polotno-app.desktop all three match (verified on VM: set_app_id("polotno-app"),
      WM_CLASS "polotno-app", "polotno-app").
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
      `deb.maintainer: Polotno <lavrton@gmail.com>` (address given by the user).
- [x] 2.3 CI: build.yml "deb smoke test" installs the deb with apt, keeps the userns restriction ON
      (so a successful render proves the AppArmor profile gives Chromium its sandbox), checks the
      /usr/bin link, aa-status, MIME registration, CLI exit code 2 on no inputs, and removal. Unpacked
      smoke test path → dist/linux-unpacked/polotno; artifact now includes dist/*.deb.
      Draft PR #5. First run failed: the runner has no desktop-file-utils, so postinst skipped
      update-desktop-database and mimeinfo.cache didn't exist → CI installs desktop-file-utils first
      (2c6442b). Green on all three OSes; the deb smoke test passes with the userns restriction on.
- [x] 2.4 Node requirement `engines` + `.nvmrc` — done in windows-release.

## Phase 3 — Editor polish
- [x] 3.1 GIF export progress: `store.saveAsGIF` has no `onProgress` (Polotno 4.14.1 types + docs),
      so `exportGIF` swaps `window.GIF` for a subclass during the export: `addFrame` counts
      captured frames ("Rendering GIF… n%"), gif.js 'progress' events cover encoding
      ("Encoding GIF… n%"). Verified in a throwaway Electron harness (Workspace mounted, 45 frames,
      both phases reach 100%, window.GIF restored, GIF saved). Still eyeball it in the app/VM.
- [x] 3.2 Vector PDF of the welcome template fails ("Monaco" → FONT_FAILED) — done in windows-release.
- [x] 3.3 Dialog titles "polotno-app" → explicit `title: 'Polotno'` — done in windows-release.

## Phase 4 — Remaining manual checks (VM 108, by hand — need the user)
Docs done: docs/linux-testing.md now has "Install the deb" (what it installs, checks), the sandbox
modes for AppImage vs deb, and deb checklist items (menu/dock grouping, .polotno double-click,
`polotno` CLI, removal).
- [ ] 4.1 Resize with transformer handles; drag-and-drop from side panel to canvas.
- [ ] 4.2 Clipboard: copy/paste text and images, in-app and from other apps.
- [ ] 4.3 HiDPI: 200% and fractional (125%/150%) scaling — canvas sharpness, title bar.
- [ ] 4.4 X11 session ("Ubuntu on Xorg"): window, menu, Alt shows the menu bar, dialogs.
- [ ] 4.5 Second instance: launching again focuses the first; opening a `.polotno` file adds
      a tab to the running app.
- [ ] 4.6 Other distros smoke test: Fedora (GNOME, libfuse differences), maybe KDE.
- [x] 4.7 deb on VM 108 (2026-09-29, over SSH + guest agent; VM NOT rolled back — the rollback was
      blocked by the permission classifier; leftovers: libfuse2t64, old AppImage, ~/.config):
      apt install OK (profile loaded, no "Skipping"), /usr/bin/polotno → /opt/Polotno/polotno,
      chrome-sandbox 0755. Restriction ON (=1): menu launch (gtk-launch polotno-app) runs with no
      --no-sandbox, main process AppArmor label "polotno (unconfined)", zygotes in their own userns,
      renderer Seccomp 2. Profile unloaded → FATAL "Rather than run without sandboxing" (exit 133);
      reloaded → works. CLI render/lint OK, no inputs → exit 2. MIME: gio content-type
      application/x-polotno, default polotno-app.desktop. `gio open design.polotno` with the app
      running → added to the running instance's tabs (session.json), no extra process left.
      Updater check runs from the deb ("0.1.1 is not available"). mcp.json execPath
      /opt/Polotno/polotno. Reinstall keeps link + profile. apt remove: link, profile (unloaded),
      menu entry, MIME, /opt/Polotno gone; ~/.config/polotno-app + ~/Documents/Polotno kept.
      AppImage with the renamed binary: CLI render OK, GUI runs with --no-sandbox (as documented),
      execPath = the .AppImage.
- [x] Dock showed a generic gear (user, 2026-09-29): electron-builder installed the lone 1024px icon to
      hicolor/1024x1024, which Ubuntu's hicolor index.theme doesn't define (max 512x512) → icon lookup
      failed. Fixed: build/icons/{16..512}x{..}.png (sips from build/icon.png) + `linux.icon: build/icons`;
      GTK lookup now resolves; CI asserts the 512 icon. Window matching was fine (app_id polotno-app).
- [ ] 4.7b deb visual checks (need eyes): dock icon while running, "Pin to Dash" → one icon,
      double-click a .polotno in Files, the X11 ("Ubuntu on Xorg") session.
- [ ] 4.8 Eyeball the GIF progress toast (Rendering → Encoding → "GIF exported").

## Phase 5 — Auto-update rehearsal
Procedure in docs/linux-testing.md › Auto-update (deb subsection added: DebUpdater + pkexec,
Restart Now / Later / cancelled prompt / manual apt upgrade).
Rehearsed 2026-09-29 on the clean VM (rolled back to clean-install) against a loopback feed
(generic provider http://127.0.0.1:8765 on the VM; old 0.1.1 / new 0.1.2 built with a copy of the
config — procedure in docs). A published GitHub release is still the final check (6.1).
- [x] 5.1 Old AppImage in ~/Applications → downloads 0.1.2 (full download: http.server has no ranges).
- [x] 5.2 Install on update → file replaced AND renamed polotno-app-0.1.1 → polotno-app-0.1.2.AppImage
      (sha matches the feed); relaunch: appVersion 0.1.2, execPath = new file, CLI works, no further
      update. (Tested via Later + quit; Restart Now uses the same install path — click it once by hand.)
- [x] 5.3 Later + quit → "Auto install update on quit", installed.
- [x] 5.4 Root-owned /opt/ro → "Updater error EACCES: permission denied, unlink …"; old file kept,
      app quit cleanly. Only visible on the console (file log: windows-release 5.6).
- [x] 5.5 deb update 0.1.1 → 0.1.2 (loopback feed): app started via `systemd-run --user` (like GNOME
      does; an SSH-session process gets no polkit agent), download → "ready" dialog → user clicked
      Restart Now + entered the password (pkexec) → dpkg upgrade done 15:28:45, app relaunched
      15:28:50 as the user, AppArmor label "polotno (unconfined)", no --no-sandbox; appVersion 0.1.2,
      /usr/bin/polotno + /etc/apparmor.d/polotno intact, CLI works.
      Observed: GNOME showed "Polotno is not responding" right after the relaunch and it cleared by
      itself — probably slow first start in the VM (software GL) plus a CLI render I ran at the same
      moment. Re-check once on a quiet VM / real hardware; if it repeats, look at startup work.
      Side finding: CLI without any display env segfaults (exit 139) → BACKLOG.
- [x] 5.6 Updater errors are only console.error'd — file log done in windows-release.

## Phase 6 — Release
- [ ] 6.1 Tag, draft release from release.yml, download the draft AppImage (and deb) onto a
      clean VM (rollback to clean-install), smoke test, publish.
- [x] 6.2 User install steps: docs/linux-install.md (deb vs AppImage table, apt install, updates,
      uninstall, libfuse2t64/libfuse2, sandbox limitation of the AppImage), linked from README.
      Use it for the release notes.
- [x] 6.3 `deb.maintainer` set to the real address.
