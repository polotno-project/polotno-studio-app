# Codex connect row + MCP SDK v2 (server/discover)

Started 2026-10-05. Context: .claude/ai-subscription-integration/PROGRESS.md (re-analysis section).

## Tasks
- [x] Connect panel: "Copy Codex config" row (config.toml block with http_headers; `codex mcp add` only
      takes --bearer-token-env-var, which needs the token exported in every shell / the Codex app)
- [x] App MCP server → @modelcontextprotocol/server v2 + createMcpHandler (serves 2026-07-28 incl.
      server/discover AND 2025-era stateless per request). v1 1.32.1 has no server/discover.
- [x] Verify with a v2 client in both modes (auto → modern, legacy) and the plain-HTTP /api routes
- [x] .mcpb proxy: decide (keep v1 pipe; server/discover gets an error → client falls back to initialize)

## Notes
- v2 docs: https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2.md and support-2026-07-28.md
- Codex config shared by CLI, desktop app, IDE extension: ~/.codex/config.toml

## Done (2026-10-05)
- Codex row: verified the generated block with `CODEX_HOME=<tmp> codex mcp get polotno` (streamable_http, bearer header).
- Server on @modelcontextprotocol/server 2.3.1 + @modelcontextprotocol/node 2.1.1 (versioned separately!).
  `app.all('/mcp', toNodeHandler(createMcpHandler(createServer)))`, express.json body passed as parsedBody so the
  100mb limit still applies (handler default is 4 MiB; verified a 6 MB call). Tool schemas wrapped in our own
  z.object (raw shapes get wrapped with the SDK's bundled zod).
- Test harness (scratchpad, not committed): fake process.parentPort + bundled out/mcp-server.cjs. Results:
  v2 auto/pin → modern era via server/discover; v2 legacy + v1 client → initialize; all see 19 tools, 12 resources,
  2 prompts, instructions (1004 chars); no token → 401; foreign Origin → 403; /api/health + /api/call unchanged.
- .mcpb proxy kept on v1: forwards server/discover without standard headers → app answers -32020 → client falls
  back to initialize (verified with v2 stdio client auto mode). Proxy upgrade in BACKLOG.md.
- Not done: no visual check of the Connect panel in the running app (row reuses CopyRow; typecheck passes).

## place_image tool + Codex end-to-end (2026-10-05)
- New tool place_image {designId, pageId?, filePath, x?, y?, width?, height?, props?, atIndex?}
  (src/mcp-server/local-image.ts reads PNG/JPEG/WebP/GIF/SVG headers for natural size; embeds as data URL;
  default = fit inside page without upscaling, centered). Parser checked on sips/cwebp-made files of every format.
- E2E on the Mac: built app launched via Playwright _electron driver (scratchpad/e2e/driver.mjs, HTTP control
  port 47800 — no tmux on this machine). Real `codex exec` (0.155.0, ChatGPT login) with the Connect-panel config
  passed as -c overrides + default_tools_approval_mode="approve": create_design → image generation → place_image
  from ~/.codex/generated_images/<thread>/… → text → render_page → lint (0 findings) → export png. 487k input
  tokens (419k cached).
- Finding: get_design_json returns 1.78 MB after place_image (base64 inline). In BACKLOG.md.
- Left behind: ~/Documents/Polotno/Codex image test.json (the test design) — ask the user before deleting.

## get_design_json elision + schema-checked element edits (2026-10-05)
- src/mcp-server/data-urls.ts: get_design_json swaps data: URLs >= 1024 chars for
  `data-elided:<mime>;bytes=<n>;sha=<16hex>`; patch_design_json / add_element / update_element / place_image restore
  them from the current design (unknown ref → invalid_args). Live test: 1.78 MB → 1,027 chars.
- Bug found in the Codex run: add_element accepted fontWeight: 700 (number); the store kept it, the saved file
  failed @polotno/schema and the design refused to reopen ("invalid-project"). Element edits are now validated
  against the schema before reaching the store (checkedEdit in tools.ts); numeric fontWeight is coerced to string.
- Broken test file left in the library: ~/Documents/Polotno/Codex image test.json (fontWeight 700). Also
  "Elision test.json" from this test. Ask the user before deleting either.

## AI side panel prototype — Codex app-server (2026-10-05)
- src/main/codex/app-server.ts: JSON-RPC over stdio to `codex app-server`.
- src/main/codex/session.ts: finds codex (login-shell PATH, then common dirs), initialize, account/read,
  ChatGPT browser sign-in (account/login/start → shell.openExternal), one ephemeral thread per design tab with
  thread/start { sandbox: read-only, approvalPolicy: never, config.mcp_servers.polotno (our URL + bearer,
  default_tools_approval_mode approve), features.image_generation, developerInstructions naming the designId },
  turn/start, turn/interrupt; maps item/* notifications to CodexEntry rows (message deltas, mcpToolCall,
  imageGeneration with a nativeImage preview of savedPath). Server requests (approvals) are declined.
- IPC: codex:status/signIn/run/stop/reset + codex:event push. Renderer: editor/codex-model.ts (MobX),
  sections/ai-section.tsx (first side-panel section "AI").
- Verified on the Mac (Playwright driver + real Codex 0.155.0, ChatGPT plus): blank design → jazz poster with a
  generated illustration (~5 min); follow-up in the same thread fixed a clipped tagline and generated/placed a
  vinyl badge (~2.5 min); Stop interrupts within ~1 s and shows "Stopped.".
- Fixed during testing: image card collapsed in an overflowing flex column (shrink-0); repeated tool rows grouped ×N.
- Open items in BACKLOG.md (SIWC, user MCP servers merge, untested states, Windows lookup, persistence).

## Bug: Connect panel stuck on "starting…" after token regeneration (2026-10-05)
- Root cause: restartMcpServer() returns before the new utilityProcess is listening (currentUrl null); the panel
  read mcp:getStatus once right after and never again. The server itself restarted fine (verified on the user's
  running instance: healthy, new token in discovery + settings).
- Refuted: port race on restart — 6 regenerations on a fixed port (41499) all kept the port.
- Fix: launcher pushes 'mcp:status' on listening/exit; the open Connect panel subscribes.
- Verified in an isolated second instance (--user-data-dir in scratchpad, so the user's running app was not
  touched): 3 UI regenerations → panel shows "running" each time; copied command carries the new token.

## Wrap-up (2026-10-05)
- User manually tested most untested paths from the testing guide (results not itemized in-session).
- Codex review requested via `codex exec` (read-only); findings handled before the PR.
- Full `npm run build` (typecheck + app + MCP server + .mcpb) passes.
- Codex review: 18 findings. Fixed + verified live: #1 (lockdown + web_search disabled), #2, #4, #5, #6, #7, #8, #10,
  #11, #14, #17. Deferred to BACKLOG.md: #3, #9, #12, #13, #15, #16, #18.
- Lockdown probe: no shell/web/user MCP servers; Codex `exec` (code-mode tool chaining) remains, no file access.
- Test designs left in ~/Documents/Polotno: Review fixes.json, Close test spare.json (plus earlier ones).
