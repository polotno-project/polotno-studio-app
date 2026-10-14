# Polish App AI features — progress

- 2026-10-14: Read the Notion task, its 4 screenshots and the tldraw "harnessing the agents" post; mapped AI panel/MCP code; wrote PLAN.md. Nothing implemented yet.
- Verified in codex 0.155.0 schema: `turn/steer` (reply mid-run), `model/list`, `turn/start.model` exist.

## Phase 1 — chat panel (2026-10-14)
Done and verified in the dev app over CDP with a real Codex run (codex 0.155.0):
- Reply while running: `runCodex` steers the running turn via `turn/steer` (session.ts `steerCodex`); falls back to a new turn if the turn ended meanwhile. Verified: a correction sent mid-run was applied in the same turn.
- Instructions: ask a question → end the turn; markdown allowed (no headings).
- Composer: one box, inline Send arrow (no "Generate"), Stop next to it while running; placeholder changes (first prompt / reply / while running).
- Empty state: intro + suggestions moved to the top of the feed.
- Markdown: `streamdown` 2.7.0 (what shadcn AI Elements uses) in `sections/ai-markdown.tsx`; Tailwind `@source` in index.css. Verified table, bold, numbered list.
- Scroll: `use-stick-to-bottom` 1.1.6; scrolling up stays put while text streams; "Jump to latest" arrow. Verified.
- AI Elements itself not copied in: tied to the Vercel `ai` SDK types; took its two building blocks instead.
- Extra fix: if config.toml's model isn't served to the account (user had `gpt-6.1-sol` → 400 on every turn), the thread uses Codex's default from `model/list`.
Not checked: dark mode look of the new composer/markdown.

## Phase 2 — concurrent editing (2026-10-14)
Cause: patch_design_json reloaded the whole design (`store.loadJSON`), rebuilding every element (resets a drag or text edit in progress, wiped undo history).
Done:
- `src/shared/design-diff.ts`: diff before/after a patch into per-id ops (set props with the value the agent saw, add/remove/order elements, pages, size). Unit tests: `npm test` (scripts/design-diff.test.mjs, 11 pass).
- MCP `get_design_json` remembers the last 4 reads per design by rev; `patch_design_json` applies the patch to the copy at `baseRev` (index paths stay right even if the user added/removed elements), diffs it, sends `apply_changes`.
- Renderer `apply-changes.ts`: applies by id in one `history.transaction` (one undo step). A prop the user changed since the read keeps the user's value and is returned as `skipped` with a note. Reorders only shuffle the agent's own slots.
- Fallback (type change, move between parents, add inside a group, root keys like unit/fonts): whole load with keepHistory, refused with rev_conflict if the design changed since the read.
- MCP instructions tell agents to pass baseRev.
Verified in the dev app over the HTTP API + CDP: user move/retype between read and patch survive; same-prop conflict kept user value + reported; one undo reverts only the agent change; user-added element doesn't shift agent index paths and keeps its z-position. Real Codex theme change while editing text: user edits kept.
Not done: update_element/set_page still overwrite blindly (they send only the props the agent names, so only same-prop races); rev still counts agent edits only.

## Phase 3.1–3.2 — generated images reach the design (2026-10-14)
Done:
- Image cards in the AI panel: "Add to design" (Polotno `selectImage`), "Background" (`page.background`), and drag onto the canvas (`unstable_registerNextDomDrop`; dropping on an image replaces it, as in Polotno's photo panel). Main keeps entry id → `savedPath` and serves the full image over `codex:image`, so the renderer never passes file paths.
- `place_image`: `as: "background"` sets the page background; fits/centers against the target page's own size (get_info now returns per-page width/height and activePageId); defaults to the page the user is on. BACKLOG #12 closed.
- Instructions (Codex developer instructions + MCP server instructions): always place a generated image; use as: "background" for backgrounds.
Verified in the dev app: API place_image as background and on a 400×1200 page (fit 400×250, centered); real Codex run "generate a background…" set the page background itself; card Background / Add to design / drop all work with the full 2.2 MB image.
Not changed: the 30 s bridge timeout — a 2.2 MB image placed well within it.
Next: 3.3 Polotno 4.15 upgrade + image-edit spike.

## Phase 3.3 — canvas AI tools on the user's Codex (2026-10-14)
Spike (codex app-server, ephemeral thread, `localImage` input, image_generation on; scripts in the session scratchpad):
- Image + separate mask image: remove OK; replace and expand poor — the model reframes (replace shifted 16% and put the object outside the mask; expand duplicated the piano).
- Cropping to the region: worse (model zoomed 1.24× and redrew).
- **Image with the area painted solid magenta: works for remove, replace and expand** — framing kept (offset ≤1%), object inside the area.
- Remove background via the image model: redraws a different object — not usable.
- Each edit takes 40–60 s; about 1 in 6 turns ended without an image (retry once).
Done:
- polotno 4.14.1 → 4.15.3 (typecheck clean).
- `src/renderer/src/editor/ai-image-tools.ts`: setReplaceObjectFunc / setRemoveObjectFunc / setExpandFunc. Paints the mask magenta (≤1536 px sent), IPC `codex:imageEdit`, then aligns the result to the original (scale/offset search on 128 px grayscale) and composites it only inside the mask with a soft edge (Expand also underlays the full result so the seam never shows the page). Opaque results are JPEG. No Codex → opens the AI panel, toast, AbortError (no error UI). Abort → `codex:imageEditCancel` → turn/interrupt.
- `session.ts` `editImageWithCodex`: throwaway ephemeral thread without MCP servers, fixed instructions, temp PNG, retry once when no image, thread/unsubscribe after.
- Upscale not registered (hidden); remove background left to Polotno (hidden here: Cloud not enabled).
Verified in the dev app via `store.setTool`: replace (cat, 38 s), remove (43 s, one undo restores), expand 1080×607 → 1080×971 (55 s, no seams), cancel mid-run (rejects "canceled", image unchanged), AI edit menu shows Generative fill + Expand.
Not verified: the "no Codex connected" path (needs signing out); the stock UI flow by mouse (same handlers as setTool).

## Phase 3.3 follow-up — verified by mouse (2026-10-14)
- Fixed: the 4.15.3 upgrade left two mobx copies (app pinned 7.0.3, polotno pins 7.0.6). App now pins mobx 7.0.6 → one copy.
- Production build, mouse only: AI edit → Expand → drag frame → Generate with Codex signed out (CODEX_HOME=empty dir) → AI panel opens on "Sign in with ChatGPT", info toast, image unchanged, no error. AI edit → Generative fill → Remove → drag selection over the saxophone → Remove with real Codex → removed in ~45 s, rest of the image intact.
- Dev server only: Polotno's canvas overlays (crop frame, expand frame, inpaint selection) don't draw. Production is fine. Logged in BACKLOG/PAPERCUTS.
- Test driver: scratchpad flow.mjs (one CDP connection; Page.bringToFront first, otherwise the hidden window throttles timers and dropdowns close).

## Phase 4.1 — model picker (2026-10-14)
Done:
- Main: `getCodexModels` (model/list, hidden ones left out unless picked) and `setCodexModel`; the pick is saved in `<userData>/codex-model.json`. IPC `codex:models`, `codex:setModel`.
- The pick goes on every `turn/start` (Codex keeps it for the thread), so a change mid-conversation applies from the next message; new threads start on it too. A pick the account no longer serves falls back to Codex's default (same check as the config.toml model).
- Panel: model menu at the bottom left of the composer (name + description per model, check on the current one).
Verified: probe against codex app-server — turn/start `model` is honoured (bogus id → 400, gpt-6-luna → answers). In the app (production build): menu lists the 7 account models, picking GPT-6-Luna saves it, a message runs and answers, the pick survives a restart.
Next: 4.2 AgentProvider abstraction, then 4.3 Claude provider.

## Phase 4.2 — provider abstraction (2026-10-15)
Done:
- `src/main/agents/provider.ts`: `AgentProvider` interface (getStatus, signIn, getModels, setModel, run (steers while a turn runs), stop, reset, resetAll, image, shutdown) + `emitAgentEvent`.
- `src/main/agents/index.ts`: registry (only Codex; `active` is fixed until 4.3). stop/reset/resetAll/image fan out to every provider, so a design's conversation is handled by whichever agent has it.
- Codex moved to `src/main/agents/codex/{provider,app-server}.ts`, exported as `codexProvider`.
- Shared types `src/shared/agent.ts` (AgentStatus/AgentEntry/AgentModels/AgentEvent; status events carry `agent`).
- IPC renamed: `codex:*` → `agent:*` (+ `agent:list`), event `agent:event`. The canvas AI tools get their own `imageEdit:status|run|cancel`, always on Codex (image generation), independent of the chat agent.
- Renderer: `agent-model.ts` (`agent`), panel header/empty state/placeholder/toast use the agent's name. Setup screens (missing/signedOut) still Codex-only → 4.4.
Verified in the dev app: agent:list/status/models, real run via the composer (background changed, reply shown), Stop mid-run ("Stopped."), New chat, imageEdit:run + cancel (AbortError after 6 s), agent:image unknown id → clear error.

### Notes for 4.3 (Claude), from current docs (code.claude.com/docs, agent-sdk 0.3.300)
- Agent SDK bundles a native claude binary (optional dep per platform); `pathToClaudeCodeExecutable` can point at the user's own `claude`.
- Policy (legal-and-compliance): third parties may not offer Claude.ai login or route Free/Pro/Max credentials for their users; "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". → spawn the user's own installed `claude`, never handle tokens; still needs Anthropic confirmation (BACKLOG licensing gate).
- Detect: `claude --version`; `claude auth status` (JSON, exit 0 when logged in, `authMethod`). SDK `accountInfo()` → {email, organization, subscriptionType…}.
- Lockdown: `settingSources: []`, `strictMcpConfig: true`, `tools: []`, `allowedTools: ['mcp__polotno__*']`, `permissionMode: 'dontAsk'`, http MCP with Bearer header. Verify the init message's `tools` list.
- Streaming input (AsyncIterable) keeps one session per tab; mid-turn messages are queued for the next turn (not injected) → "steer" = queue; `interrupt()`, `setModel()`, `supportedModels()` ({value, displayName, description}).
- Stream: `includePartialMessages` → stream_event content_block_delta text_delta; assistant tool_use blocks; result subtypes success/error_*.
- systemPrompt: preset `claude_code` + `append`, or own string (then add a line on system reminders).
- CLI alternative: `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --strict-mcp-config --mcp-config … --tools "" --allowedTools "mcp__polotno__*" --permission-mode dontAsk`.
Next: 4.3.
