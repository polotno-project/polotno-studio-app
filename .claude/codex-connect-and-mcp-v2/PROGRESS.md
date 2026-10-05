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
