# Testing the Linux build

The Linux build ships as an x64 AppImage (`electron-builder.yml` → `linux.target`).
This guide covers getting a build onto an Ubuntu 24.04 Desktop VM, the 24.04
gotchas, a manual test checklist, and resetting the VM afterwards.

## The test VM

| | |
|---|---|
| Proxmox node | `<node>` (<proxmox-host>) |
| VMID / name | `108` / `ubuntu2404-polotno-test` |
| Resources | 4 vCPU, 6 GB RAM, 40 GB qcow2 disk on a file-based storage (qcow2, for snapshots) |
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
guest agent is installed, in Proxmox under VM 108 → Summary. It was `<vm-ip>` at setup. In the
examples below `$VM` is `polotno@<vm-ip>`.

## 1. Get a build

**From CI (any PR or push).** `build.yml` uploads each platform's installers
as an artifact named `polotno-<runner OS>`. The Linux one contains the
AppImage and `latest-linux.yml`. Artifacts are kept for 14 days.

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
#   dist/linux-unpacked/polotno-app   (unpacked app, the one the CI smoke test runs)
```

## 2. Copy it to the VM

```sh
scp dist/polotno-app-*.AppImage $VM:~/
ssh $VM 'chmod +x ~/polotno-app-*.AppImage'
```

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

An AppArmor profile for `/tmp/.mount_*/polotno-app` does **not** change this,
because the launcher probes with `/usr/bin/unshare`, which the profile doesn't
cover. A real fix needs a deb/rpm package that installs its own profile
(`BACKLOG.md`).

Check which mode the app is running in:

```sh
pgrep -a polotno-app | head -3   # "--no-sandbox" on the main process = unsandboxed
```

Test both modes:

- **Stock (what users get):** restriction on, the app runs with `--no-sandbox`.
- **Sandboxed:** `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
  (resets on reboot; the CI smoke test does the same). There's no
  `--no-sandbox`, and a `--type=zygote` process without `--no-sandbox` appears.

## 4. Manual test checklist

Run the AppImage from a terminal so errors show up:
`~/polotno-app-*.AppImage 2>&1 | tee ~/polotno.log`.

- [ ] **Launch**, in both sandbox modes: window opens and shows the editor.
      Expected noise in the VM: `Exiting GPU process due to errors during
      initialization` (no GPU with the std display; Chromium falls back to
      software rendering).
- [ ] **Window appears on Wayland**: Electron 38+ often never fires
      `ready-to-show` on Wayland ([electron#48859](https://github.com/electron/electron/issues/48859)).
      Before the fix in `src/main/window.ts` (show on `did-finish-load` too) the app
      ran, its MCP API even worked, but no window was ever mapped. Verify with
      `WAYLAND_DEBUG=client ./polotno-app-*.AppImage 2>&1 | grep -m1 set_title`.
      If a launch seems to do nothing, check `pgrep -a polotno-app`: an existing
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
      files is not expected to work.)
- [ ] **Export, every format**: PNG, JPEG, PDF (vector), PDF (flat), SVG, HTML,
      JSON, animated GIF, and **MP4**. MP4 goes through `@polotno/video-export`
      (WebCodecs) with no hardware encoder in the VM. Check it finishes, the
      progress toast reaches 100%, and the file plays (`totem` or `ffprobe`).
      Animated GIF takes ~25 s in the VM (1080×1080, 75 frames, ~11 MB) with no
      progress indicator; wait for the save dialog before retrying.
- [ ] **Fonts**: bundled fonts render in the canvas and in exports, and vector
      PDF embeds them. Try a design with a Cyrillic/CJK fallback. System fonts
      (e.g. Ubuntu, DejaVu) show up if the app lists them.
- [ ] **MCP server**: after launch `~/.config/polotno-app/mcp.json` exists, with `pid`
      and `url`, and `execPath` pointing at the `.AppImage` file itself, not
      `/tmp/.mount_*`. The file is removed on quit.
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
- [ ] **Auto-update**: see below.

### Last run (2026-09-28, 0.1.1 + this branch, stock 24.04.5, Wayland)

Window, ☰ menu, Open/Save dialogs (GNOME portal), and all nine export formats
pass: PNG, JPEG, vector PDF (Helvetica + Noto Emoji embedded), flattened PDF,
SVG, HTML, GIF, MP4 (H.264 1080×1080 30 fps), JSON. Shortcuts with the menu bar
hidden: Ctrl+O opens the Open dialog, Ctrl+E the quick PNG export's Save dialog.
A lone Alt does not reveal the hidden menu bar on Wayland (the ☰ button is the
way in). Not yet covered: drag-drop, clipboard, HiDPI, X11 session, second
instance, auto-update.

**Don't test shortcuts by typing into the noVNC console from a Mac**: it
remaps modifiers (Ctrl+O arrived as a plain `o`; other combos opened Files and
Firefox via GNOME Super shortcuts). Inject real key presses at the virtual
keyboard instead: Proxmox API `PUT /nodes/<node>/qemu/108/sendkey` with
`key=ctrl-o` (or `qm sendkey 108 ctrl-o` in the Proxmox shell).

### Driving the VM's session over SSH

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
from an AppImage, because it needs the `APPIMAGE` env var. It checks 10 s after
startup, downloads in the background, and replaces the `.AppImage` file in
place on restart.

1. Put an AppImage older than the current release in `~/` (an older release
   asset, or a CI artifact built from an older commit/version).
2. Launch it and wait. The "Polotno x.y.z is ready" dialog appears; or use the
   menu item to check for updates.
3. Click **Restart Now**. The same file path now holds the new version (check
   the version in About or `mcp.json`'s `appVersion`), and the app relaunches.
4. Also test **Later** + quit: the update installs on quit.

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
