# Testing the Linux build

The Linux build ships as an x64 AppImage and an x64 `.deb` (`electron-builder.yml`
→ `linux.target`). This guide covers getting a build onto an Ubuntu 24.04
Desktop VM, the 24.04 gotchas, a manual test checklist, and resetting the VM
afterwards. The user-facing install steps are in [linux-install.md](linux-install.md).

## The test VM

| | |
|---|---|
| Proxmox node | `<node>` (<proxmox-host>) |
| VMID / name | `108` / `ubuntu2404-polotno-test` |
| Resources | 4 vCPU, 6 GB RAM, 40 GB qcow2 disk on file-based storage (so snapshots work) |
| OS | Ubuntu 24.04.5 Desktop (GNOME) |
| User | `polotno`; the Mac's `~/.ssh/id_ed25519` key is authorized |
| Clean snapshot | `clean-install`: fresh install + openssh-server + qemu-guest-agent + SSH key. Stock otherwise: no `libfuse2t64`, userns restriction on |

The VM takes a large share of the host's RAM, so shut it down when you're not
testing.

Screen access: the Proxmox console in the browser (VM 108 → Console) works
for everything, including the login screen and the Wayland/Xorg session
choice. GNOME Remote Desktop (Settings → System → Remote Desktop → Remote
Login) with the Windows App on the Mac is an alternative, but it didn't
connect on the first try; see `PAPERCUTS.md`. There's no SPICE viewer on
Homebrew. HDMI on the host shows only the Proxmox text console.

The IP comes from DHCP. Look it up in the VM (`ip -4 a`) or, since the QEMU
guest agent is installed, in Proxmox under VM 108 → Summary. In the examples below `$VM` is
`polotno@<vm-ip>`.

## 1. Get a build

**From CI (any PR or push).** `build.yml` uploads each platform's installers
as an artifact named `polotno-<runner OS>`. The Linux one contains the
AppImage, the deb and `latest-linux.yml`. Artifacts are kept for 14 days.

```sh
gh run list --workflow Build --branch <branch> --limit 5
gh run download <run-id> -n polotno-Linux -D /tmp/polotno-linux
```

**Local, from the Mac.** electron-builder can build the x64 AppImage on macOS,
Apple Silicon included:

```sh
npm run build                      # without VITE_POLOTNO_KEY in env/.env, renders carry a
                                   # "free license limitation exceeded" banner
npx electron-builder --linux --x64 --publish never
# → dist/polotno-app-<version>.AppImage
#   dist/polotno-app_<version>_amd64.deb
#   dist/linux-unpacked/polotno   (unpacked app, the one the CI smoke test runs)
```

The Mac has no `dpkg-deb`; inspect a deb with `ar x` + `tar`:

```sh
mkdir /tmp/deb && cd /tmp/deb && ar x ~/…/dist/polotno-app_*_amd64.deb
tar -xOf control.tar.xz ./control             # Package, Depends, Maintainer
tar -xOf control.tar.xz ./postinst | head -20  # /usr/bin link, AppArmor install
tar -tvf data.tar.xz | grep -v locales         # file list
```

Linux containers can't run AppArmor, so they only cover part of it. On Apple
Silicon an amd64 `ubuntu:24.04` container (`docker run --platform linux/amd64`)
can `apt install ./dist/*.deb`, check the `/usr/bin/polotno` link and MIME
registration, and run
`xvfb-run -a polotno --no-sandbox render …` as root. The AppImage runtime
itself fails there with "Exec format error"; unpack it with
`unsquashfs -o <offset>` (offset = end of the ELF section headers) and run
`squashfs-root/AppRun`.

## 2. Copy it to the VM

```sh
scp dist/polotno-app-*.AppImage dist/polotno-app_*_amd64.deb $VM:~/
ssh $VM 'chmod +x ~/polotno-app-*.AppImage'
```

### Install the deb

```sh
ssh -t $VM 'sudo apt install ~/polotno-app_*_amd64.deb'
```

What the package does (electron-builder's stock `postinst`/`postrm`):

| | Installed | Removed by `apt remove polotno-app` |
|---|---|---|
| App | `/opt/Polotno/` (binary `/opt/Polotno/polotno`) | yes |
| CLI | `/usr/bin/polotno` → `/etc/alternatives/polotno` → `/opt/Polotno/polotno` | yes |
| AppArmor | `/etc/apparmor.d/polotno` (`userns`, unconfined), loaded right away | unloaded and deleted |
| Menu entry | `/usr/share/applications/polotno-app.desktop` (`StartupWMClass=polotno-app`) | yes |
| Icon | `/usr/share/icons/hicolor/{16…512}x{16…512}/apps/polotno.png` (from `build/icons/`) | yes |
| MIME | `/usr/share/mime/packages/polotno.xml`: `application/x-polotno` = `*.polotno` | yes |
| Updates | `resources/package-type` = `deb`, so electron-updater uses its deb updater | — |

Check it:

```sh
readlink -f /usr/bin/polotno                            # /opt/Polotno/polotno
sudo aa-status | grep -w polotno                        # profile loaded
xdg-mime query default application/x-polotno            # polotno-app.desktop
gio info -a standard::content-type ~/x.polotno          # application/x-polotno
```

The deb and the AppImage can be installed side by side (different binaries
and paths). They share `~/.config/polotno-app` and the single-instance lock, so
run only one of them at a time.

`gh run download` can also run inside the VM once `gh` is installed and logged in.

## 3. Ubuntu 24.04 gotchas

### libfuse2

AppImages mount themselves with FUSE 2, which 24.04 doesn't ship. Without it:

```
dlopen(): error loading libfuse.so.2
AppImages require FUSE to run.
```

Fix: `sudo apt install libfuse2t64`. (Don't install the `fuse` package: it
replaces `fuse3` and can break the desktop.) Workaround without FUSE:
`./polotno-app-*.AppImage --appimage-extract-and-run`.

### Chromium sandbox vs. AppArmor user-namespace restriction

Ubuntu 24.04 sets `kernel.apparmor_restrict_unprivileged_userns=1`. Chromium's
sandbox needs unprivileged user namespaces, and the SUID fallback
(`chrome-sandbox`) can't work inside an AppImage because the squashfs mount
can't carry a root-owned setuid bit.

electron-builder's AppImage launcher (`AppRun`, electron-builder 26) handles
this itself. It runs `unshare -Ur true` and, **if that fails, starts the app
with `--no-sandbox` prepended**. So on a stock 24.04 install:

- the app starts, but **without the Chromium sandbox**;
- `process.argv[1]` is `--no-sandbox`. `src/main/index.ts` drops it before
  looking for the `render`/`lint` command; without that, the CLI would open
  the GUI instead.

An AppArmor profile for `/tmp/.mount_*/polotno` does **not** change this,
because the launcher probes with `/usr/bin/unshare`, which the profile doesn't
cover. This stays a documented AppImage limitation
([linux-install.md › Sandbox](linux-install.md#sandbox)).

**The deb fixes it.** It installs `/etc/apparmor.d/polotno`, which allows user
namespaces for `/opt/Polotno/polotno`. Nothing adds `--no-sandbox` there, and
`chrome-sandbox` isn't setuid, so on stock 24.04 the deb runs sandboxed or
doesn't start at all ("No usable sandbox"). The CI deb smoke test relies on
exactly that.

Check which mode the app is running in:

```sh
pgrep -a polotno | head -3   # "--no-sandbox" on the main process = unsandboxed
cat /proc/$(pgrep -o -x polotno)/attr/current   # deb: "polotno (unconfined)" = profile applied
pgrep -af 'type=zygote'      # sandboxed: zygote processes without --no-sandbox
```

Test these modes:

- **AppImage, stock (what AppImage users get):** restriction on, the app runs
  with `--no-sandbox`.
- **AppImage, sandboxed:** `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
  (resets on reboot; the CI AppImage smoke test does the same). There's no
  `--no-sandbox`, and a `--type=zygote` process without `--no-sandbox` appears.
- **deb, stock:** restriction on (don't touch the sysctl). Sandboxed, as above.
  `sudo apparmor_parser -R /etc/apparmor.d/polotno` (unload the profile) must make it
  fail to start; `sudo apparmor_parser -r /etc/apparmor.d/polotno` restores it.

## 4. Manual test checklist

Run the AppImage from a terminal so errors show up:
`~/polotno-app-*.AppImage 2>&1 | tee ~/polotno.log`. For the deb, start it from
the app menu, or run `polotno 2>&1 | tee ~/polotno.log`.

Run the checklist on the deb, and repeat launch, sandbox, dialogs, one export
and the CLI on the AppImage.

- [ ] **deb install**: `sudo apt install ./polotno-app_*_amd64.deb` pulls in the
      dependencies with no errors; the checks in "Install the deb" pass;
      there's no "Skipping the installation of the AppArmor profile" line.
- [ ] **App menu + dock (deb)**: Polotno appears in Activities with its icon
      and launches. While it runs, the dock shows the Polotno icon (not a
      generic one), and pinning it to the dock ("Pin to Dash") then relaunching
      from the pin gives one icon, not two. Same in an X11 session. The window
      identifiers must all be `polotno-app`: Wayland `app_id` (from package.json
      `desktopName`; `WAYLAND_DEBUG=client polotno 2>&1 | grep -m1 set_app_id`),
      X11 `WM_CLASS` (from package.json `name`; `xprop WM_CLASS`, or
      `--ozone-platform=x11` under Wayland) and `StartupWMClass` in the
      .desktop file. Electron takes the two from different fields, so
      `desktopName` must stay `<name>.desktop`.
- [ ] **.polotno double-click (deb)**: in Files, a `.polotno` file shows
      "Polotno design file" as its type; double-click opens it in Polotno, and
      with the app already running it opens as a new tab in the running window.
- [ ] **`polotno` CLI (deb)**: from any directory, `polotno render design.polotno
      -o out.png` and `polotno lint design.polotno --json`; `polotno render`
      without inputs exits 2.
- [ ] **deb removal**: `sudo apt remove polotno-app` removes `/usr/bin/polotno`,
      `/etc/apparmor.d/polotno` (and `aa-status` no longer lists it), the menu
      entry; `~/.config/polotno-app` and `~/Documents/Polotno` stay.
- [ ] **Launch**, in each sandbox mode: window opens and shows the editor.
      Expected noise in the VM: `Exiting GPU process due to errors during
      initialization` (no GPU with the std display; Chromium falls back to
      software rendering).
- [ ] **Window appears on Wayland**: Electron 38+ often never fires
      `ready-to-show` on Wayland ([electron#48859](https://github.com/electron/electron/issues/48859)).
      Before the fix in `src/main/window.ts` (show on `did-finish-load` too) the app
      ran, its MCP API even worked, but no window was ever mapped. Verify with
      `WAYLAND_DEBUG=client ./polotno-app-*.AppImage 2>&1 | grep -m1 set_title`.
      If a launch seems to do nothing, check `pgrep -a polotno`: an existing
      instance without a window swallows new launches (single-instance lock).
- [ ] **Wayland vs X11**: 24.04 runs GNOME on Wayland. Since Electron 38 the app
      runs natively on Wayland there (`--ozone-platform` defaults to `auto`).
      Test both native Wayland and XWayland (`--ozone-platform=x11`), and also an
      "Ubuntu on Xorg" session (gear icon on the login screen). Check window
      decorations, resize, maximize, menus/popovers, drag-drop and clipboard in each.
- [ ] **HiDPI**: Settings → Displays → Scale 200% and a fractional one (125%;
      enable fractional scaling first). UI stays crisp, canvas isn't blurry,
      export pixel size is unaffected.
- [ ] **File dialogs**: Open, Save As, export and the .mcpb save all use the GTK
      or portal dialog. Default name and filters are right, and cancel does nothing.
- [ ] **Drag and drop**: images from Files (Nautilus) onto the canvas, and a
      `.polotno` file onto the window opens it.
- [ ] **Clipboard**: copy/paste elements inside the app, paste an image copied
      in another app (e.g. a screenshot), and copy text out to another app.
- [ ] **Open from argv**: `./polotno-app-*.AppImage ~/design.polotno` opens the file.
      **Second instance**: with the app running, run the same command with
      another file. It opens in the running window (single-instance lock) and
      no second window or process remains.
      (The AppImage installs no .desktop entry, so double-clicking `.polotno`
      files only works with the deb.)
- [ ] **Export, every format**: PNG, JPEG, PDF (vector), PDF (flat), SVG, HTML,
      JSON, animated GIF, and **MP4**. MP4 goes through `@polotno/video-export`
      (WebCodecs) with no hardware encoder in the VM. Check it finishes, the
      progress toast reaches 100%, and the file plays (`totem` or `ffprobe`).
      Animated GIF takes ~25 s in the VM (1080×1080, 75 frames, ~11 MB): a toast
      shows "Rendering GIF… n%" (frame capture), then "Encoding GIF… n%", then
      "GIF exported" once the save dialog opens.
- [ ] **Fonts**: bundled fonts render in the canvas and in exports, and vector
      PDF embeds them. Try a design with a Cyrillic/CJK fallback. System fonts
      (e.g. Ubuntu, DejaVu) show up if the app lists them.
- [ ] **MCP server**: after launch `~/.config/polotno-app/mcp.json` exists, with `pid`
      and `url`, and `execPath` pointing at the `.AppImage` file itself, not
      `/tmp/.mount_*` (deb: `/opt/Polotno/polotno`). The file is removed on quit.
      `wget -qO- "$(jq -r .httpUrl ~/.config/polotno-app/mcp.json)/health"` answers
      (no token needed; loopback only; stock 24.04 has wget and jq but no curl).
      Connect panel → export `Polotno.mcpb` (save dialog) and install the skills
      (`~/.claude/skills/polotno-design` appears).
- [ ] **CLI render**, in both sandbox modes above; a GUI instance may run at the
      same time. The CLI opens a hidden window, so it needs a display. Over SSH,
      either borrow the logged-in desktop session or use Xvfb
      (`sudo apt install xvfb`, then prefix the command with `xvfb-run -a`):
      ```sh
      export XDG_RUNTIME_DIR=/run/user/$(id -u) WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland
      ./polotno-app-*.AppImage render design.json -o out.png --pixel-ratio 1 && file out.png
      ./polotno-app-*.AppImage lint design.json --json; echo "exit $?"
      ```
      Without any display env (`env -u DISPLAY -u WAYLAND_DISPLAY polotno render x.json`)
      it prints "polotno needs a display …" and exits 1 (it used to core dump, 139).
- [ ] **Auto-update**: see below.

### Last run (2026-09-28, 0.1.1 + this branch, stock 24.04.5, Wayland)

Window, ☰ menu, Open/Save dialogs (GNOME portal), and all nine export formats
pass: PNG, JPEG, vector PDF (Helvetica + Noto Emoji embedded), flattened PDF,
SVG, HTML, GIF, MP4 (H.264 1080×1080 30 fps), JSON. Shortcuts with the menu bar
hidden: Ctrl+O opens the Open dialog, Ctrl+E the quick PNG export's Save dialog.
A lone Alt does not reveal the hidden menu bar on Wayland (the ☰ button is the
way in).

Editor: Unsplash photos load and insert; elements select, move, delete; undo and
redo; text insert + in-place editing; font picker search and apply (Lobster
from Google Fonts); colour picker; shapes; add page; timeline playback; Animate,
Layers and Background panels; autosave to `~/Documents/Polotno/<name>.json`
keeps all of it.

Not yet covered: resizing with transformer handles and drag-and-drop from the
side panel (automation drags in one jump, so a failure there proved nothing —
check by hand), clipboard, HiDPI, X11 session, second instance, auto-update.

**Don't test shortcuts by typing into the noVNC console from a Mac**: it
remaps modifiers (Ctrl+O arrived as a plain `o`; other combos opened Files and
Firefox via GNOME Super shortcuts). Inject real key presses at the virtual
keyboard instead. The console can also leave Shift stuck down (typing a
capital letter), after which every click extends the selection;
`qm sendkey 108 shift` releases it. For key combos use Proxmox API `PUT /nodes/<node>/qemu/108/sendkey` with
`key=ctrl-o` (or `qm sendkey 108 ctrl-o` in the Proxmox shell).

### Driving the VM's session over SSH

`sudo` over SSH asks for a password; the QEMU guest agent runs commands as
root without one (Proxmox API `POST /nodes/<node>/qemu/108/agent/exec`, or the
proxmox MCP `execute_vm_command`). Handy for `apt install ./….deb` and
`apparmor_parser`.

To stop the app, kill only the main process: `kill $(pgrep -o -x polotno)`.
`pkill -x polotno` also SIGTERMs the zygote/GPU children, and the browser then
aborts with "GPU process isn't usable" plus a core dump, which looks like a crash
but isn't. And `pkill -f /opt/Polotno/polotno` inside `ssh '…'` kills the SSH
shell itself (its own command line matches).

To start the GUI from SSH in the logged-in desktop session:

```sh
export XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 XDG_SESSION_TYPE=wayland \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
# for XWayland (--ozone-platform=x11, xprop, xwininfo) also:
export DISPLAY=:0 XAUTHORITY=$(ls /run/user/1000/.mutter-Xwaylandauth.* | head -1)
nohup ~/polotno-app-*.AppImage > ~/polotno.log 2>&1 &
```

### Auto-update

electron-updater reads `latest-linux.yml` from the latest **published** GitHub
release (drafts are invisible to it). On Linux it only updates when launched
from an AppImage (or the deb, below), because it needs the `APPIMAGE` env var.
It checks 10 s after startup, downloads in the background, and replaces the
`.AppImage` on restart or quit. When the file name contains the old version
(`polotno-app-0.1.1.AppImage`), the new file gets the new name
(`polotno-app-0.1.2.AppImage`) and the old one is deleted, so a launcher or
script pointing at the old path breaks; `mcp.json` `execPath` follows.

1. Put an AppImage older than the current release in `~/` (an older release
   asset, or a CI artifact built from an older commit/version).
2. Launch it and wait. The "Polotno x.y.z is ready" dialog appears; or use the
   menu item to check for updates.
3. Click **Restart Now**. The file is replaced by the new version (renamed if
   the name carried the version; check About or `mcp.json`'s `appVersion`), and
   the app relaunches.
4. Also test **Later** + quit: the update installs on quit.
5. AppImage in a folder the user can't write to (e.g. `sudo mkdir /opt/ro &&
   sudo cp` it there): the update must fail without breaking the running app.
   The error goes to the console (run from a terminal to see it):
   `Updater error EACCES: permission denied, unlink '/opt/ro/…AppImage'`; the
   old file stays and the app quits normally.

#### Rehearsing without a GitHub release

A published release is the real test, but the whole flow can run against a
feed on the VM's own loopback. Build the old and the new version with a
`generic` publish provider in a copy of the config, outside `dist/`:

```sh
# eb-feed.yml = electron-builder.yml with
#   publish: { provider: generic, url: http://127.0.0.1:8765 }
# and '!dist/**' added to files (with another output dir, dist/ isn't
# excluded automatically and the installers end up inside the app).
npx electron-builder --linux --x64 --publish never --config eb-feed.yml -c.directories.output=/tmp/dist-old
npx electron-builder --linux --x64 --publish never --config eb-feed.yml -c.directories.output=/tmp/dist-new \
  -c.extraMetadata.version=0.1.2
```

Copy `dist-new/{latest-linux.yml,*.AppImage,*.deb}` to `~/feed` on the VM and
serve it there with `python3 -m http.server 8765 --bind 127.0.0.1`. Install or
run the `dist-old` build. `http.server` has no range requests, so the log
shows "Cannot download differentially, fallback to full download", which is
fine; GitHub supports ranges.

#### deb

The deb updates itself too. `resources/package-type` says `deb`, so
electron-updater (6.8+) picks its deb updater: it downloads the `.deb` listed
in `latest-linux.yml` (the file lists both the AppImage and the deb) and, on
Restart Now or on quit, installs it with `dpkg -i` through a graphical
privilege prompt (`pkexec` on stock Ubuntu; it also tries gksudo, kdesudo,
beesu). If dpkg fails on dependencies it runs `apt-get install -f -y`.

1. Install an older deb (an older release asset, or a CI artifact from an
   older version): `sudo apt install ./polotno-app_<old>_amd64.deb`.
   Launch it from the desktop, not from an SSH shell: pkexec asks the
   session's polkit agent, and a process in an SSH session has none. Over SSH,
   `systemd-run --user --setenv=WAYLAND_DISPLAY=wayland-0 /opt/Polotno/polotno`
   starts it the way GNOME does (logs: `journalctl --user -u <unit>`).
2. Launch from the app menu and wait for the "Polotno x.y.z is ready" dialog.
3. **Restart Now** → a password prompt (polkit) appears; after it, the app
   relaunches on the new version (`apt policy polotno-app`, About,
   `mcp.json` `appVersion`).
   `sudo aa-status | grep -w polotno` still lists the profile, and
   `/usr/bin/polotno` still works (the upgrade re-runs postrm + postinst).
4. **Later** + quit: the prompt appears on quit and the update installs.
5. **Cancel** the password prompt: the app must quit or keep running cleanly,
   with the old version still installed and working.
6. Apt users who never get the prompt (e.g. no polkit agent) update by
   downloading the new deb and running `sudo apt install ./…deb` over the old
   one; settings and designs are kept.

## 5. Reset the VM

Roll back to `clean-install` after each test round, or before a new build, so
the results don't depend on leftover state (`~/.config/polotno-app`, installed
AppArmor profiles, apt packages, sysctls).

- **Proxmox UI**: VM 108 → Snapshots → `clean-install` → Rollback.
- **proxmox-mcp-plus** (e.g. from Claude Code in this repo):
  `rollback_snapshot(node="<node>", vmid="108", snapname="clean-install")`.
- **Proxmox shell**: `qm rollback 108 clean-install`.

The snapshot is taken without RAM, so the VM is stopped after a rollback.
Start it again and wait for SSH.
