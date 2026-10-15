# AI polish backlog sweep

Items added to BACKLOG.md during .claude/polish-ai-features (2026-10-14..16).

## Status
- [x] 45 My designs: shift-click range + select-all (verified: cmd-click 2nd + shift-click 5th → 4 selected; Select all → 15; Cancel → 0)
- [x] 31 Dark mode: Streamdown used undefined shadcn tokens → white borders + outer frame; restyled in index.css (verified dark + light via CDP media emulation)
- [x] 34 Canvas AI tools: loading toast "Codex is editing the image / about a minute", dismissed on finish/cancel (verified in dev: Remove → toast; Отмена → gone)
- [x] 38 startFailure(): verified with a fake 2.0.1 claude (POLOTNO_CLAUDE_BIN) → "expects 2.1.300 or newer, run claude update" in models call and in the feed
- [x] 37 loginShellEnv(): verified with SHELL=fake shell exporting an empty CLAUDE_CONFIG_DIR → status signedOut; normal launch → ready, run OK
- [~] 36 Windows lookup implemented (PATHEXT, ~/.local/bin, %APPDATA%/npm, cmd.exe for codex.cmd); no Windows machine here → unverified
- [x] 43 Codex images copied to userData/chats/images/<sha1(entry id)>.<ext>; agentImage falls back to it; removed with the chat / design (verified: generate → restart → Add to design adds it; library delete empties the folder)
- [x] 32 tools.ts `seen` map (read + agent edits) → update_element/set_page go through apply_changes with base; verified via ext.mjs: user fill/background kept + reported, agent fontSize/duration applied, agent re-edit of own value OK, re-read clears, undo is one step, missing element still element_not_found
- [x] 40 get_design_json: `pages` param; over 40k chars → active page full, others one-line outlines (brief counts if still too big). 12 pages/240 texts: 22 KB. Verified: patch into an outlined page; Codex and Claude both edited an element on an outlined page
- [x] 44 thumbnails.ts: hidden store + off-screen WorkspaceCanvas (HiddenStages), one at a time, library:writePreview (library folder only). Verified: 13 of 14 missing thumbnails appeared within ~15 s of opening My designs; the 14th is a file the app rejects as invalid-project (opening it fails too)
- [x] 41 scripts/agent-bench.mts (npm run bench:agents): panel setup from src/main/agents/lockdown.ts + instructions.ts, MCP via mcp.json; Codex usage from thread/tokenUsage/updated. Verified: welcome.json "title red" — Claude haiku 34k in/$0.0026/6 s; Codex 74k in/11 s
- [x] 39 Docs: >50,000-char text results always go to a file, no off switch. get_design_json keeps under 40k (explicit pages: brief outlines, else too_large). Verified: 12 pages requested → too_large; 1 page → 21.6 KB
- [x] 35 Dev-only overlay bug = StrictMode remount + react-konva-utils Portal cleanup destroying the group; StrictMode removed (verified: crop grid + generative fill selection draw in dev)
- [ ] 42 Parallel chats
- [ ] 33 On-device background removal (license)
