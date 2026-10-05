# Using the user's AI subscription for in-app generation

Status: analysis done (2026-09-25), nothing implemented yet.

## What exists
The app runs an MCP server at 127.0.0.1:41414 with 19 tools. The user's own agent (Claude Desktop/Code, Cursor,
VS Code, Codex) drives the editor, and those tokens come out of the user's subscription. The missing half is
generation that starts from inside the app.

## Options, verified 2026-09-25
| Path | Subscription | Text | Images | Policy |
|---|---|---|---|---|
| Existing MCP, user's agent drives the app | any | yes | Codex only (gpt-image-2) | fine |
| Codex `app-server` (JSON-RPC over stdio), spawned by the app | ChatGPT Plus/Pro | yes | yes, built-in gpt-image-2 | documented for third-party clients; no explicit ToS text |
| GitHub Copilot SDK with the user's OAuth token | Copilot | yes | no | officially supported, billed to the user |
| ACP client (`@agentclientprotocol/sdk`), agents: codex-acp, Copilot, Gemini, claude-agent-acp | per agent | yes | per agent | claude-agent-acp is Agent SDK based, so the Claude login is a risk |
| The user's unmodified `claude -p` CLI | Claude Pro/Max | yes | no (SVG only) | grey: carve-out for the unmodified binary, but Consumer Terms forbid automation |
| MCP sampling | client's | yes | no | deprecated in spec 2026-07-28; Claude clients never supported it |
| Apple Foundation Models / PCC via Swift helper | free | yes (macOS 26+) | Image Playground sheet only (UI) | fine |
| Ollama / LM Studio | free, local | yes | weak or experimental | fine |
| Gemini CLI OAuth, Claude OAuth in the app, web-session scraping | — | — | — | forbidden |

## Recommended plan
1. MCP gap: add a tool that places an image from a local file path. Codex writes generated images to disk, but
   `add_element` expects a URL or data URL.
2. An "AI" side panel behind a provider interface:
   - Codex app-server first: the only sanctioned path that also gives images.
   - Then the Copilot SDK.
   - Then the user's own `claude` CLI, spawned with `--mcp-config` pointing at our server and stream-json output.
   - Pass the app's MCP server into every agent session so edits land live and share the undo stack.
3. Quick local text actions (rewrite, translate, headline ideas) on Apple FM or Ollama. Free and instant.
4. Skip: sampling, ChatGPT/claude.ai remote apps (they need a public HTTPS endpoint or tunnel), and anything that
   touches vendor credentials.

## Verification pass (2026-09-25, primary sources)
- Anthropic (code.claude.com/docs/en/legal-and-compliance): products that run Claude Code must agree to the
  Commercial ToS, keep the binary unmodified, and never pay for or intermediate usage. There is an explicit carve-out
  for "an end user … signing in to the unmodified Claude Code binary with their own Claude subscription". A Claude.ai
  login inside the app or the Agent SDK with OAuth is forbidden. Consumer Terms §3(7) ban automated access unless
  "explicitly permit[ted]".
- MCP sampling is deprecated in spec 2026-07-28 (SEP-2577). Claude connectors list it as not supported; Claude Code
  issue #1785 is still open.
- Codex app-server is intended for "deep integration inside your own product" (stdio JSONL; `account/login/start`
  with chatgpt or chatgptDeviceCode). gpt-image-2 image generation is confirmed and burns limits 3–5x faster.
  Community sources say files land in ~/.codex/generated_images. OpenAI has no explicit third-party ToS text.
  auth.json is "like a password", so never touch it and never use chatgptAuthTokens.
- Copilot SDK: "Copilot usage is billed to each user's subscription". Officially OK.
- Gemini CLI was retired on 2026-06-18 for free/Google One/AI Pro users and replaced by Antigravity CLI (smaller free
  tier, ACP missing at launch). Drop it from the plan.
- Apple: Foundation Models plus free Private Cloud Compute (under 2M downloads). ImageCreator stops working in
  macOS 27; image generation is UI-only.

## Codex image test (2026-09-25), passed
- Command: `codex exec --skip-git-repo-check --sandbox workspace-write --json -C <dir> "<prompt> … save PNG to <dir>/out.png"`
  with codex-cli 0.155.0, ChatGPT login, feature `image_generation` stable.
- Result: exit 0 after 52 s. Codex wrote a 1254x1254 PNG to ~/.codex/generated_images/<thread_id>/exec-*.png, then
  copied it to our path and resized it with sips.
- The JSONL stream has no dedicated image item: we only see thread.started (which gives the thread_id), shell
  commands, and the agent's final message. Look for the file in generated_images/<thread_id>/ rather than trusting
  what the agent says.
- Cost: 118k input tokens (103k cached) for one image. The user's global MCP servers and skills load on every run
  (one Cloudflare MCP server failed auth here, harmlessly). Try `-c mcp_servers={}` or app-server with a minimal
  config to cut overhead and latency.

## Re-analysis (2026-10-05, after master 0.1.2)
Code on master: still no in-app generation and no Codex-specific code. New since last pass: stateless MCP server
(fresh server per request) and an .mcpb proxy that never exits (Cowork server/discover fix). Connect panel offers
Claude Desktop (.mcpb), Cursor, VS Code, Claude Code command, raw JSON, and a skill install. No Codex row.
Plain-HTTP /api/call routes + /api/health exist for curl-only agents.

Landscape changes since 2026-09-25 (primary sources, via research agent):
- OpenAI launched Sign in with ChatGPT (SIWC) 2026-09-29. App-server auth "has never been permitted for commercial
  or hosted services"; local/open-source apps may keep using it but should migrate to SIWC (registered client_id +
  ext_agent_host_id). Commercial apps: interest form. This settles the Codex policy question → apply for SIWC.
- codex app-server now emits a typed ImageGeneration thread item with savedPath; thread/start takes a `config` map
  (per-thread mcp_servers injection, inferred from code). codex-cli 0.160.0.
- Codex: `codex mcp add polotno --url <url> --bearer-token-env-var POLOTNO_TOKEN`; no install deeplink.
- MCP spec 2026-07-28 is stateless: initialize removed, servers MUST implement server/discover. We are on
  @modelcontextprotocol/sdk 1.30.0 (latest 1.32.0) and rely on clients falling back to initialize.
- MCP Apps (ui:// resources) supported by Claude, VS Code, Codex: an option for an in-chat design preview.
- Copilot SDK GA, billed to the user's allowance, no image generation. codex-acp 2.x, claude-agent-acp, copilot --acp.
- Windsurf is now Devin Desktop; Gemini CLI → Antigravity CLI (`serverUrl` + headers).
- Apple FM (macOS 27): image input, better tool calling, PCC access.

Bug found: vendored skill local-app.md uses `{url}/api/health` / `{url}/api/call/<verb>`; url ends in /mcp → 401.
Should be `{httpUrl}/health`, `{httpUrl}/call/<verb>`. Logged in BACKLOG.md.
