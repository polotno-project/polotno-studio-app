# Windows support

Goal: make the Windows build usable, not just buildable. Branch `nikigan/windows`.

## Plan
1. [x] Title bar: window controls overlay must not cover Connect AI / Export; overlay symbols follow theme
2. [x] App menu reachable on Windows (hidden title bar hides the menu bar) — menu button in the tab strip
3. [x] CLI: `polotno.cmd` wrapper (waits, keeps exit code), added to user PATH by the NSIS installer; Windows CI smoke test
4. [x] Atomic save: retry rename on EPERM/EBUSY/EACCES (AV / indexer / watcher holding the file)
5. [x] Case-insensitive path comparison on Windows (tabs, recent list)

## Out of scope (needs accounts / real hardware)
- Azure Trusted Signing, Windows auto-update rehearsal, manual client checks on Windows

## Notes
- Electron attaches a packaged Windows app to the parent console (unless ELECTRON_NO_ATTACH_CONSOLE), so CLI output does print; the problem is interactive cmd/PowerShell not waiting for a GUI-subsystem exe.

## Status (2026-09-25)
All five items implemented. Verified on macOS: typecheck, `electron-builder --win --x64` builds (NSIS
compiles installer.nsh incl. uninstaller macro), `resources\bin\polotno.cmd` packaged with CRLF,
macOS tab strip unchanged (padding-right 8px, no menu button).
NOT verified on real Windows yet — see BACKLOG.md. The Windows CI job now runs the CLI through polotno.cmd.
