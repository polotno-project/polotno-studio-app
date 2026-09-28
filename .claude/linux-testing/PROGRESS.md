# Linux testing — progress

Branch: nikigan/linux-testing

## Tasks
- [x] token.ts: discovery execPath uses `process.env.APPIMAGE ?? process.execPath`
- [x] build.yml: upload installers with actions/upload-artifact
- [x] build.yml: Linux CLI smoke test under xvfb-run
- [x] deb/rpm targets — asked: user said "not now" (stays in BACKLOG)
- [x] Proxmox: read-only inspection
- [x] Proxmox: plan approved by user (6 GB RAM, <storage>, desktop 24.04.5.1 ISO, I configure via API)
- [x] Proxmox: VM 108 created, cloudinit drive removed, ISO local:iso/ubuntu-24.04.5.1-desktop-amd64.iso attached, boot=order=scsi0;ide2, cpu=host, started
- [x] User installed Ubuntu 24.04.5 (user polotno, IP <vm-ip>)
- [x] SSH key auth (Mac id_ed25519), snapshot `clean-install` taken (VM stopped, no RAM); VM notes set
- [x] docs/linux-testing.md (verified libfuse error, sandbox behavior, CLI render, execPath on the VM)
- [x] Fixed: CLI broke on stock 24.04 because AppRun prepends --no-sandbox (src/main/index.ts)
- [x] Fixed: no window on Wayland — Electron 38+ ready-to-show bug (electron#48859); window.ts also shows on did-finish-load on Linux. Verified via WAYLAND_DEBUG (xdg_toplevel set_title). Waiting for user's visual confirmation.
- [x] Linux menu: burger button in the tab strip (copied from nikigan/windows c01e38d, shown on Windows and Linux), autoHideMenuBar on Linux. Deployed to VM; waiting for user's visual check (button, popup, Alt, Ctrl+O/S/E).
- [x] Rebased onto origin/nikigan/windows (user's choice): picks up the GIF fix (922b598) and master's vector-PDF fix; menu commit shrank to hasMenuButton = !isMac + autoHideMenuBar. Backup ref: backup/linux-testing-pre-rebase.
- [x] Manual GUI test on the VM via the Proxmox noVNC console: window, ☰ menu, dialogs, all 9 export formats pass (see docs 'Last run').
- [ ] Remaining manual checks: shortcuts, drag-drop, clipboard, HiDPI, X11 session, second instance, auto-update
- [ ] Push branch / open PR — only when user asks

## Notes
- Commits: 74f24b5 (token.ts), 0d07b54 (CI). CI not yet run — branch not pushed.
- Unpacked Linux binary is dist/linux-unpacked/polotno-app. Local AppImage: dist/polotno-app-0.1.1.AppImage (built on the Mac).
- CI smoke test lifts kernel.apparmor_restrict_unprivileged_userns instead of --no-sandbox: the CLI rejects Chromium switches (backlogged).
- MCP create_vm hardcodes vga=std, boot=scsi0, no ISO; adds cloudinit ide2 on dir storage.
- VM 108 is currently dirty vs clean-install: libfuse2t64 installed, AppImage + template + out.png in ~, ~/.config/polotno-app. Roll back before real testing.
- Verified on VM: electron-builder AppRun adds --no-sandbox when `unshare -Ur true` fails; with sysctl userns=0 the zygote runs sandboxed and render works.
