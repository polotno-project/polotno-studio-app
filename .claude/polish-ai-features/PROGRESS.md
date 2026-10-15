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

## Phase 4.3 + 4.4 — Claude provider, agent switcher, setup per agent (2026-10-15)
Done:
- `src/main/agents/claude/provider.ts`: Agent SDK (`@anthropic-ai/claude-agent-sdk` 0.3.300, devDependency → bundled into main) with `pathToClaudeCodeExecutable` = the user's installed `claude` (never the SDK's bundled binary; their own login, the app never touches credentials).
  - Status: `claude --version` + `claude auth status` (JSON; exit 1 when signed out), re-checked on each status call. Plan shows as "Claude Max".
  - Sign-in: not in-app (policy: login must go through Anthropic's flow; the paste-code flow would put us in the middle). Panel shows `claude auth login` + Try again.
  - Session per design: streaming input queue; `settingSources: []`, `strictMcpConfig`, `skills: []`, `permissionMode: 'dontAsk'`, `persistSession: false`, tools = only ListMcpResourcesTool/ReadMcpResourceTool (design guide) + `mcp__polotno__*`. Verified the init tool list is exactly those.
  - Feed from stream events (text deltas per content block, tool_use start) + tool_result frames; API-error assistant frames → error rows.
  - Turn state: each sent message has a uuid; Claude folds mid-turn messages into the running turn (or runs them next); `user_message_uuids` on assistant/result frames say which were taken; the turn is over when a result leaves none pending.
  - Models: `supportedModels()` from a throwaway session (cached); aliases only (default/opus/fable/sonnet/haiku), pinned versions hidden unless picked; pick in `<userData>/claude-model.json`, applied to live sessions with `setModel`.
  - Stop → `interrupt()` → "Stopped."; the session keeps going for the next message.
- Shared: `find-binary.ts` (Codex + Claude), `instructions.ts` (images on/off), `settings.ts`. Provider interface: `conversations()` replaces `resetAll` (registry adds the notes).
- Registry: active agent kept in `<userData>/agent.json`; `agent:setActive` ends that agent's open conversations with a note "Switched to X. The next message starts a new conversation."
- Panel: agent picker in the header (Codex / Claude), per-agent install / sign-in screens (Codex: npm + Sign in with ChatGPT; Claude: install.sh / install.ps1 + `claude auth login`), per-agent empty-state copy and suggestions (Claude: no image generation). Canvas AI tools keep running on Codex; their toast says to switch the panel to Codex when Claude is active.
Verified (dev app, real Claude Max account, Haiku 5.5): models menu (5 aliases), pick persists; prompt → tools run live, subtitle added, reply streamed; mid-run "make the remaining circles gold" folded into the same turn and applied; Stop mid-run → "Stopped.", next message answered; switch to Codex via header menu → note in the feed, Codex status/models back; Claude signed out (CLAUDE_CONFIG_DIR empty) → sign-in screen; no claude on PATH → install screen. Production build: Claude status/models/run OK. Typecheck, eslint (only the old export-menu error), prettier, npm test 11/11.
Gotcha: a query() cwd that doesn't exist fails as "native binary … failed to launch … libc" (PAPERCUTS).
Next per plan: Phase 5 (agent cursor visuals), Phase 6 (token optimizations), Phase 7 (multiple chats); non-AI track (side-panel tab per design, templates panel).

## Phase 5 — agent cursor on the canvas (2026-10-15)
Done:
- `agent-activity.ts`: every design command over the bridge (panel agent or any agent connected via Connect AI) becomes an activity per design: mode read/write, label ("Editing “Up to 50% off”", "Adding an image", "Removing 2 elements", "Reading the design", "Looking at the design", "Checking the layout"…), targets (element ids, page ids, or a screen rect measured before a removal). Planned before the command runs, shown after (new ids from the result). Holds 2.5 s, then stale; a stale cursor stays (name only) while the panel's agent turn runs, then fades. Agent name recorded per activity: the panel agent while its turn runs, else "AI agent".
- `canvas-rects.ts`: screen rects from Polotno's Konva stages (stage attr `pageId`, `.page-background`, `#elementId`) limited to the visible editor (hidden stages of background tabs excluded). Text has no Konva node with its id (rendertag shape), so its box comes from the model (x/y/size/rotation) scaled onto the page rect.
- `agent-cursor.tsx`: overlay in WorkspaceWrap, pointer-transparent, follows targets every frame while shown (scroll/zoom safe). Cursor glides to the last target's centre with a name tag; each target gets an outline (write) or dashed scan sweep (read), replayed per command. index.css: transitions/keyframes; prefers-reduced-motion → no glide, no sweep.
- Hooked in `bridge.ts` (plan → execute → show).
Verified (dev app): Claude run (title white, then circles one by one) → cursor over the title with "Claude · Editing …", then each circle, read sweep over the page for get_json/render/lint, fades after the turn. Outside MCP client (ext.mjs, @modelcontextprotocol/sdk): add_element/update_element (rotated, outline is the rotated bbox)/remove_element (outline where it was) labelled "AI agent". Reduced motion emulated: transition only opacity, no scan animation. Typecheck, eslint (only old errors/warnings in untouched files), tests 11/11, production build.
Next per plan: Phase 6 (token optimizations, measured), Phase 7 (multiple chats); non-AI track.

## Phase 6 — token/speed optimizations, measured (2026-10-16)
Benchmark: scratchpad `bench/bench.mts` runs Claude Code (same lockdown as the panel, Haiku 5.5) against the running dev app's MCP server on a fixed fixture, recording result.usage, cost, turns, time and each tool result's size. Fixtures: src/renderer/src/templates/social-media-post.json (1 page, 9 els) and welcome.json (4 pages, 47 els).
Baseline finding: welcome.json's get_design_json was 54–62 KB; Claude Code rejects MCP results over its token limit and saves them to ~/.claude/projects/…/tool-results with "read the file", but the panel agent has no file tool → it never saw the design and guessed from renders (14–20 turns). A wrong patch path also returned the whole design tree in the error (10 KB).
Done:
1. Compact get_design_json (`src/shared/compact-design.ts`): props at Polotno's default dropped (defaults read from a throwaway store per element type, renderer `element-defaults.ts`, DesignCommand `get_defaults`, asked once by the MCP server), fractions rounded to 2 decimals; id/type/box/text always kept. Patches still apply to the full read copy; only leaf keys dropped so paths match (tested: add and replace of an omitted prop). welcome: 62 KB → 15.6 KB; social post: 9.3 KB → 3.5 KB.
2. invalid_patch errors name the failing operation only.
3. `check: true` on patch_design_json / update_element / add_element / set_page / remove_element returns the render of the changed page + lint findings (all touched pages) with the edit (MCP: text + image content; HTTP: `render` field).
4. Instructions: start from get_design_json for edits; read archetypes/rubric (design-format) only for new designs/redesigns (no SKILL.md read every conversation); one patch for several changes; check: true on the last edit.
5. Panel agents don't get list_designs/create_design/open_design/save_design (`PANEL_HIDDEN_TOOLS`; Claude `disallowedTools`, Codex `mcp_servers.polotno.disabled_tools`): −690 tokens per model call.
Results (Haiku, input tokens incl. cache / turns / time / cost, mean):
- Headline + gradient on social post: base 81.6k / 9 / 16.9 s / $0.0050 (3 runs) → final 52.3k / 5.3 / 11.8 s / $0.0029 (3 runs): −36% tokens, −42% cost.
- Fonts on all 4 pages of welcome: base 132k / 17 / 45 s / $0.0070, design never read (2 runs) → final 34.8k / 3 / 9.4 s / $0.0030 (3 runs, identical): −74% tokens, −57% cost, 5× faster, one patch.
- Add a CTA (final only): 40.3k / 4 / 20 s.
- Fixed per-call overhead ("hi", no tools): 6.7k → 6.4k.
Verified in the app: Codex lists 16 polotno tools (hidden 4 gone), Codex edit = read + one edit with check, reply cites lint; Claude edit in the panel = read + edits with check, no guide read. Typecheck, eslint, prettier, tests 14/14 (new compact-design tests), production build + MCP server build. Benchmark designs (saved into ~/Documents/Polotno by create_design) deleted.
Not measured: Codex token usage (no usage capture in the app); same tool changes apply to it.
Next per plan: Phase 7 (multiple chats, exploration), non-AI track (side-panel tab per design, templates panel).

## Phase 7 step 1 — several chats per design, kept and continued (2026-10-16)
Decision: the app keeps chats itself (userData/chats/<sha1(design file path)>.json), not the agents' own history (Codex threads stay ephemeral, Claude persistSession stays off — no design content in ~/.codex or ~/.claude). Continuing an old chat (picked from the list, after a restart, or after switching agents) starts a fresh agent conversation whose instructions include the chat's words (prompts, replies, generated-image notes; last 8000 chars). The agent re-reads the design anyway.
Done:
- `src/main/agents/chats.ts`: per open design a book {filePath, chats, activeId}; every feed entry (emitAgentEvent) is recorded into the open chat (a new one on the first message, titled by it), saved at most once a second; reopened designs open their most recent chat. listChats / startNewChat / selectChat / deleteChat / chatContext / moveChats (save-as / first save) / closeChats (tab close) / renameChatsOf + deleteChatsOf (library rename/delete).
- Registry: runAgent passes chatContext when the agent has no live conversation for the design; New chat (agent:reset) keeps the old chat; agent:chats / agent:selectChat / agent:deleteChat; switch-agent note now "Switched to X. It reads this chat before your next message."
- Providers: run(docId, prompt, context) — context joins the session's instructions (Claude systemPrompt, Codex developerInstructions) on a new conversation. First tried prepending it to the user message: Haiku sometimes called the transcript unverifiable and said UNKNOWN; in the instructions it recalled it 7/7 (5 Haiku, 2 Sonnet, scratchpad bench/prime.mts).
- Renderer: agent-model mirrors chats (loads when a design's panel shows, reloads on a 'chats' event, keeps the live feed when the open chat didn't change); panel header gets a History menu (newest first, check on the open chat, relative time, delete on hover), disabled while a run is going.
Verified (dev app): code word told in chat 1 → New chat doesn't know it → History → chat 1 → knows it (Claude); restart → panel shows the latest chat, list intact; reopen the code-word chat after restart → Claude recalls; switch to Codex via the header → note, Codex recalls the word in the same chat; delete a chat from the menu (list + file); library rename moves the chat file, delete removes it. Typecheck, eslint, tests 14/14, production build.
Not built: parallel chats on one design (two agents at once). Image entries restored after a restart still show their preview; "Add to design" says the image is no longer available (the full image lives in the provider's memory).
Next per plan: non-AI track (side-panel tab per design, templates panel).
