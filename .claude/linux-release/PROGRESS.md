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
      Codex review (PR #5, P2): overlapping GIF exports (two tabs) stacked the window.GIF wrapper and
      could leave a stale one → exports now run one at a time (module-level promise queue). Harness:
      two concurrent exports get 91 events each (no cross-talk), window.GIF === original afterwards.
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
- [x] 4.7b Dock icon + Pin to Dash checked by the user after the icon fix: working.
- [x] 4.7c-1 Open a .polotno from Files (Enter on the selected file — noVNC double-clicks only
      select) with the app running: added as a 2nd tab to the running instance, one main process.
      But GNOME showed '"Polotno" is ready' instead of raising the window (Wayland focus-stealing
      prevention: win.focus() in second-instance has no xdg-activation token) → BACKLOG.
      The .polotno file shows a generic text icon in Files (MIME type has no icon) → BACKLOG.
- [ ] 4.7c-2 X11 ("Ubuntu on Xorg") session — needs a logout + password at the login screen (user).
- [x] 4.8 GIF progress toast: Rendering → Encoding → dismissed at the save dialog → "Saved to …" (7.2).

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

## Phase 7 — Follow-ups (2026-09-29)
- [x] 7.1 CLI without a display: `requireDisplay()` in src/main/cli exits 1 with an xvfb-run hint
      when neither DISPLAY nor WAYLAND_DISPLAY is set (JS runs before Chromium's ozone init — a
      usage error still printed there). Verified on VM 108 by swapping a rebuilt app.asar into
      /opt/Polotno/resources (original kept as app.asar.orig): exit 1 + message; with Wayland env
      render still exits 0. CI deb smoke test asserts exit 1. README + linux-testing.md updated.
- [x] 7.2 Export toasts say where the file went: main's will-download handler forwards each
      download's 'done' (state + item.getSavePath()) as `export:downloadDone`; App.tsx toasts
      "Saved to <path>" (completed) / "The export could not be saved." (interrupted), nothing on
      cancel. GIF/MP4 loading toasts are dismissed instead of claiming "exported" early.
      Typecheck OK. Verified on VM 108 (patched app.asar, via the Proxmox noVNC console in the
      browser, 2026-09-29): PNG → "Saved to /home/polotno/Downloads/🚀-big-news!-….png"
      (2160×2160 on disk); JPEG dialog cancelled → no toast; GIF → "Rendering GIF… n%" →
      "Encoding GIF… n%" → toast gone when the dialog opened → "Saved to /home/polotno/….gif"
      (1080×1080, 10 MB). The local build has no Polotno/Unsplash keys, so the canvas shows the
      free-trial banner and Photos fails — expected, not a release issue.
      Restore afterwards: `cp /opt/Polotno/resources/app.asar.orig /opt/Polotno/resources/app.asar`
      (as root) or reinstall the deb.

## Phase 6 — Release
- [ ] 6.1 Tag, draft release from release.yml, download the draft AppImage (and deb) onto a
      clean VM (rollback to clean-install), smoke test, publish.
- [x] 6.2 User install steps: docs/linux-install.md (deb vs AppImage table, apt install, updates,
      uninstall, libfuse2t64/libfuse2, sandbox limitation of the AppImage), linked from README.
      Use it for the release notes.
- [x] 6.3 `deb.maintainer` set to the real address.

## Open questions
- Save As writes `.json` (files.ts:107, since d09a636) while the file association / Linux MIME cover
  only `*.polotno` → app-saved designs don't double-click-open in Polotno. Asked the user
  (A: default .polotno on Save As, B: + library, C: keep .json and fix README). User: no change for
  now → BACKLOG.md. PR #5 marked ready for review.


## Phase 8 — Other distros (2026-09-30, user: "proceed with builds for other distros")
Scope: rpm (Fedora/RHEL/openSUSE) + pacman (Arch/Manjaro) next to AppImage + deb; arm64 stays in BACKLOG.
Facts: electron-builder 26.15.3 builds both via fpm and writes resources/package-type, so
electron-updater picks RpmUpdater (zypper/dnf/yum/rpm via pkexec) / PacmanUpdater. The stock
after-install script is shared with the deb (update-alternatives link, MIME/desktop DB, AppArmor only
when apparmor_status is enabled). Default pacman depends include http-parser (dropped from Arch) →
needs a custom list. rpm default depends use Fedora names → soname requires work on openSUSE too.
- [x] 8.1 electron-builder.yml: rpm + pacman targets. maintainer moved deb → linux (fpm needs it for
      every target). rpm depends = sonames (+ `(dejavu-sans-fonts or dejavu-fonts)`: minimal openSUSE has
      no font → Skia FATAL "Not implemented"), `fpm: --directories=/opt/Polotno` (otherwise empty dirs
      stay after removal). pacman depends = deb set under Arch names + ttf-font.
      Artifacts: polotno-app-<v>.x86_64.rpm, polotno-app-<v>-x64.pacman.
- [x] 8.2 Built on macOS (`brew install rpm` for rpmbuild). Containers (amd64, --security-opt
      seccomp=unconfined, as a non-root user): fedora:latest (44), opensuse/tumbleweed, archlinux:latest →
      install, /usr/bin/polotno link, no missing libs in ldd, globs2 + mimeinfo.cache, package-type,
      xvfb-run render ~500 KB PNG exit 0, no inputs exit 2, remove leaves no /usr/bin/polotno or /opt/Polotno.
- [x] 8.3 CI: build.yml + release.yml install rpm + libarchive-tools on Linux before packaging;
      build.yml runs scripts/linux-package-smoke.sh in fedora/opensuse/arch containers (script passes
      locally on all three); artifact includes *.rpm and *.pacman. latest-linux.yml lists all four files.
- [x] 8.4 Docs: linux-install.md (table + rpm/pacman sections), linux-testing.md, README.
- [ ] 8.5 Not rehearsed: in-app update for rpm (RpmUpdater → pkexec dnf/zypper) and pacman
      (PacmanUpdater → pkexec pacman -U) — needs a desktop VM with a polkit agent (Fedora VM, like 5.5).
      Not checked on a real desktop: menu entry/dock icon on Fedora GNOME / openSUSE / Arch (4.6).

## Phase 9 — Visual tests on Fedora + Arch VMs (2026-09-30, user chose "Fedora + Arch VMs")
Packages: CI run 36714269554 artifact (has the Polotno key), in the session scratchpad `ci/`.
Host has 15.4 GB; HA uses 8 GB → VM 108 shut down, new VMs run one at a time.
ISOs downloading to `local`: Fedora-Workstation-Live-44-1.7.x86_64.iso, archlinux-x86_64.iso (sha256 checked).
VMs are created via the Proxmox API from the logged-in web UI tab (fetch with Proxmox.CSRFPreventionToken;
the MCP can't attach an ISO or import a disk). The live-ISO GUI install was abandoned (noVNC typing drops keys,
installer footer off-screen) → cloud images instead: downloaded to local ISO storage as
fedora-44-cloud-base.img / arch-cloudimg.img (sha256 checked), VM created with
`scsi0: nas-disk:0,import-from=/var/lib/vz/template/iso/<img>,format=qcow2`, `ide2: nas-disk:cloudinit`,
ciuser polotno + the Mac's ssh key, ipconfig0 dhcp, then resized to 40G. Passwordless sudo via cloud-init.
GNOME via `dnf install @workstation-product-environment`, graphical.target, GDM autologin for polotno.
- [x] 9.1 Fedora 44 VM 109 (192.168.0.155, DHCP): cloud image + GNOME 50 (Wayland), snapshot clean-install.
- [x] 9.2 Fedora (CI rpm, SELinux enforcing): `sudo dnf install ./polotno-app-0.1.1.x86_64.rpm` pulled
      dejavu-sans-fonts; xdg-mime: application/x-polotno → polotno-app.desktop. Activities search "polo" shows
      Polotno with its icon; Enter launches it; overview labels the window "Polotno" with the app icon (desktop
      match). Chromium sandbox ON: no --no-sandbox, sandboxed zygote in its own user namespace, renderer seccomp
      mode 2. Unsplash photos load (CI key). Double-click sample.polotno in Files (opened from GNOME) → "sample"
      tab in the running app, second instance exits; GNOME shows '"Polotno" is ready' (same Wayland focus
      limitation as Ubuntu, already in BACKLOG). Export → PDF → GTK dialog "Export" in ~/Downloads → Save →
      toast; file 45 KB %PDF, NotoEmoji embedded, Arial → Helvetica (expected).
      Finding: a Files window started over SSH inherits XDG_SESSION_TYPE=tty; a second instance launched from it
      picks X11, fails "Missing X server or $DISPLAY" and then hangs in anon_pipe_write instead of exiting
      (3/3). Not reachable from a real desktop launch → BACKLOG (GUI path without a usable display).
- [x] 9.3 Arch VM 110 (192.168.0.187, no guest agent in the image → found via MAC/arp; guest agent installed
      afterwards): Arch cloud image 2026-09-15 + `pacman -S gnome qemu-guest-agent` (GNOME 50 Wayland),
      snapshot clean-install.
- [x] 9.4 Arch (CI pacman): `pacman -U` added only libxss; Activities search shows Polotno + icon; launches;
      overview labels the window "Polotno"; sandboxed zygote in its own user namespace; Files (from GNOME)
      double-click → "sample" tab, second instance exits; PNG export → dialog suggests
      "🚀-big-news!-we're-launching-something.png" → 2160×2160 PNG.
      Finding (fixed): wide gaps between words in the UI ("Photos   by   Unsplash", "Connect  AI"). CDP
      CSS.getPlatformFontsForNode: the stacks ('…"Helvetica Neue", "Noto Sans", Arial, sans-serif, …"Noto Color
      Emoji"', once via --default-font-family, once hard-coded in the panel CSS) name no GNOME 50 font; letters
      came from Nimbus Sans (gsfonts, fontconfig's Helvetica/Arial alias), the space from Noto Color Emoji.
      ttf-font was satisfied by gnu-free-fonts (no effect); ttf-dejavu, ttf-liberation, cantarell-fonts
      didn't fix it; noto-fonts did → pacman depends ttf-font → noto-fonts (106 MiB). Verified on the rolled-back
      VM with a local build: noto-fonts pulled in, spacing normal from the first launch. Arch container smoke OK.
      Not bugs (my SSH launches): export named "download" = app started over SSH without LANG (from Activities
      the name is right); second-instance hang = XDG_SESSION_TYPE=tty (see 9.2).
VMs: 109 and 110 shut down after testing; VM 108 (Ubuntu) left stopped.

## Phase 10 — rpm/pacman in-app update rehearsal (2026-10-08, user: "test in-app updates in VMs")
Same loopback-feed method as Phase 5 (docs/linux-testing.md › Rehearsing without a GitHub release):
old 0.1.1 / new 0.1.2 rpm + pacman built with a generic provider http://127.0.0.1:8765.
The cloud-image user has no password → polkit prompt can't be answered: first check the prompt appears
and Cancel keeps the old version; then a VM-only polkit rule (/etc/polkit-1/rules.d/49-polotno-test.rules,
pkexec for user polotno without auth) to exercise the real install path. Roll back to clean-install after.
- [x] 10.1 Feed packages (scratchpad eb-feed.yml = config + generic provider + '!dist/**'): 0.1.1, 0.1.2, 0.1.3.
- [x] 10.2 Fedora VM 109 (app launched from Activities; GNOME screen lock disabled + session unlocked via
      `loginctl unlock-session`, the cloud user has no password):
      0.1.1 checks the feed ~13 s after start, downloads the full rpm to ~/.cache/polotno-app-updater/pending,
      "Polotno 0.1.2 is ready" dialog. Restart Now → GNOME polkit prompt "Authentication is needed to run
      `/bin/bash -c dnf install --nogpgcheck … polotno-app-0.1.2.x86_64.rpm` as the super user" → Cancel: app
      keeps running (same pid), 0.1.1 still installed, CLI works, download stays pending.
      With the test polkit rule: Restart Now → dnf upgrade → app relaunches itself as 0.1.2 (mcp.json appVersion).
      BUG found + fixed: after the upgrade /usr/bin/polotno was gone — rpm runs the new %post before the old
      %postun, and electron-builder's stock after-remove does `update-alternatives --remove` unconditionally.
      Fix: rpm.afterRemove = build/linux/rpm-after-remove.tpl (stock script + `exit 0` when $1 >= 1).
      Re-run from clean-install with fixed 0.1.1/0.1.2: Restart Now → 0.1.2 relaunched 10:54:07, link intact,
      CLI exit 2 on no inputs. Later + quit (0.1.2 → 0.1.3): installed on quit, app stays closed, link intact.
      Fedora container smoke (uninstall still removes the link and /opt/Polotno) passes with the fix.
      Console/journal: the app's console.log doesn't reach `journalctl --user` (only the unit start line);
      the feed server's access log shows the requests instead.
- [ ] 10.3 Arch VM 110: same with pacman -U
