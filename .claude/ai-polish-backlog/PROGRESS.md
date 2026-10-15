# AI polish backlog sweep

Items added to BACKLOG.md during .claude/polish-ai-features (2026-10-14..16).

## Status
- [x] 45 My designs: shift-click range + select-all (verified: cmd-click 2nd + shift-click 5th → 4 selected; Select all → 15; Cancel → 0)
- [x] 31 Dark mode: Streamdown used undefined shadcn tokens → white borders + outer frame; restyled in index.css (verified dark + light via CDP media emulation)
- [x] 34 Canvas AI tools: loading toast "Codex is editing the image / about a minute", dismissed on finish/cancel (verified in dev: Remove → toast; Отмена → gone)
- [x] 38 startFailure(): verified with a fake 2.0.1 claude (POLOTNO_CLAUDE_BIN) → "expects 2.1.300 or newer, run claude update" in models call and in the feed
- [x] 37 loginShellEnv(): verified with SHELL=fake shell exporting an empty CLAUDE_CONFIG_DIR → status signedOut; normal launch → ready, run OK
- [~] 36 Windows lookup implemented (PATHEXT, ~/.local/bin, %APPDATA%/npm, cmd.exe for codex.cmd); no Windows machine here → unverified
- [ ] 43 Restored chat images: Add to design
- [ ] 32 update_element / set_page base-value check
- [ ] 40 Per-page summaries for huge designs
- [ ] 44 Missing thumbnails rendered in background
- [ ] 41 Token benchmark as repo script (+ Codex usage)
- [ ] 39 Claude Code tool-results on disk
- [x] 35 Dev-only overlay bug = StrictMode remount + react-konva-utils Portal cleanup destroying the group; StrictMode removed (verified: crop grid + generative fill selection draw in dev)
- [ ] 42 Parallel chats
- [ ] 33 On-device background removal (license)
