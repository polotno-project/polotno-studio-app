# Polish App AI features — plan

Source: Notion task "Polish App AI features" (https://app.notion.com/p/3f72e311ee098034bf71e47352a6eea3),
plus https://tldraw.dev/blog/harnessing-the-agents. Code facts verified 2026-10-14 at 07051c7;
Codex protocol checked against `codex app-server generate-json-schema` (codex-cli 0.155.0).

## Root causes found

| Report | Cause |
|---|---|
| Text moved back while the agent recolored | `patch_design_json` applies the patch to a fresh snapshot, then `store.loadJSON` replaces the **whole** design (executor.ts:88-96, tools.ts:431). Any user edit made between the read and the load is lost. `rev` counts only agent commands (bridge-router.ts:75-80), so `baseRev` can't see user edits. `loadJSON` also likely wipes undo history. |
| Can't answer a question mid-run | Composer blocks submit while `running` (ai-section.tsx:137); main throws "already working" (session.ts:368). Codex has `turn/steer {threadId, expectedTurnId, input}`, which is unused. |
| "Generate" when continuing | Same button for first prompt and follow-ups (ai-section.tsx:159-173). |
| Markdown shows raw | No markdown renderer; plain `whitespace-pre-wrap` (ai-section.tsx:114-117). |
| Can't scroll while streaming | `scrollIntoView` on every delta (`lastSize` dep), no "stick to bottom only if already at bottom" (ai-section.tsx:216-222). |
| Background image not added, can't add manually | Lockdown (322b050) removed shell, so the model may not learn the saved path; `ImageCard` has no action; renderer never receives the path (session.ts:208-216, ai-section.tsx:69-100). |
| No model choice | `thread/start`/`turn/start` pass no model. `model/list` exists; `turn/start.model` overrides per turn. |
| No CLI choice | Everything is `codex:*`-specific; no provider abstraction. |
| Canvas AI tools absent | Polotno flags off (`removeBackgroundEnabled`, `aiTextEnabled`); they need the Polotno cloud API. Inpaint/expand/remove-object are not in SDK 4.14.1. |
| Side panel resets on tab switch | `<PolotnoEditor key={docId}>` remounts; SidePanel opens `defaultSection` ("photos") on mount; `openedSidePanel` is not saved per tab (App.tsx:58, polotno-editor.tsx:86). Templates Library/My designs toggle is local state (templates-section.tsx:170). |

## Phase 1 — Chat panel fixes (small, high value)

1. **Reply while running.** While a turn is active the composer sends via `turn/steer` (needs the active turn id, which session.ts already tracks for interrupt). Button becomes Send + a separate small Stop icon. Show the steered message in the feed immediately.
2. **Send, not Generate,** once the feed has messages. Keep "Generate" (or just an arrow icon) for the first prompt only.
3. **Markdown rendering.** Add `react-markdown` + `remark-gfm` (tables, bold, lists, code); style with Tailwind typography-like classes scoped to the feed. Drop the "No markdown headings" instruction or keep headings small. Fetch current docs before adding.
4. **Scroll.** Track "pinned to bottom" from the feed's scroll position; auto-scroll only when pinned; show a "Jump to latest" pill otherwise.
5. **Composer layout.** Move suggestions + intro into the empty feed area (top/center, like ChatGPT/Claude empty states); composer becomes a single compact box with an inline send button. Decide with screenshot mock first.
6. **shadcn AI components.** We already use Polotno primitives (base-ui + cva, shadcn-style) and Tailwind v4, so shadcn's AI chat pieces (prompt input, message, conversation with stick-to-bottom, reasoning/tool rows) are a good fit to copy in (copy-paste model, not a dependency). Check the current registry (shadcn "AI Elements") via docs before deciding; likely adopt Conversation/StickToBottom + PromptInput + Response(markdown) and restyle to Polotno tokens. This can absorb items 3–5.

## Phase 2 — Safe concurrent editing (the conflict bug)

Goal: agent edits never overwrite user edits they didn't touch.

1. **Apply patches as granular store ops, not `loadJSON`.** Translate JSON Patch ops on `/pages/i/children/j/<prop>` into `element.set({prop})`, add/remove ops into `page.addElement`/`element.remove`/`page.addPage`; only fall back to `loadJSON` for structural ops we can't map (and then with `keepHistory: true`). Wrap in one history transaction so the agent's change is one undo step.
2. **Address elements by id, not index.** Index paths go stale when the user reorders/adds. Either resolve indices against the snapshot the agent read (map index → id at read time, keep a per-thread snapshot by `rev`) or add an id-based edit tool (`update_elements([{id, props}])`) and steer the skill toward it.
3. **Real revision counter.** Bump `rev` on user edits too (MST `onSnapshot`/`onPatch` in the renderer, debounced, reported to main). Then a stale `baseRev` patch on a touched element can be rejected or field-merged instead of silently clobbering.
4. **Field-level merge rule:** agent wins only for props it changed; props the user changed since the agent's read are kept, and the agent gets a "conflict: x,y changed by user on element E" note in the tool result so it can re-read.
5. Optional: lock/flash elements the agent is editing (ties into Phase 4 visuals).

## Phase 3 — Images and canvas AI tools

1. **Generated image → design.** Send `savedPath` (main side) with the image entry; `ImageCard` gets "Add to design" and "Set as background" actions (main reads the file via the existing local-image path into a data URL; set `page.background` or add a full-bleed image). Also make it draggable onto the canvas.
2. **Agent placement.** Developer instructions: after `imageGeneration`, call `place_image` with the saved path (pass the path back to the model in context if the image item lacks it). Add an `as: 'background'` option to `place_image` and fix the per-page sizing (BACKLOG #12). Raise/stream the 30 s bridge timeout for big images.
3. **Canvas AI tools — decision 2026-10-14: run them on the user's own agent.**
   - Polotno ships the editor side since 4.15 (installed: 4.14.1 → upgrade). `polotno/config`: `setExpandFunc`, `setReplaceObjectFunc`, `setRemoveObjectFunc`, `setUpscaleFunc`, `setRemoveBackgroundFunc`; helpers in `polotno/utils/image-edit` (`prepareImageInput`, `padImageForFrame`, `formatMask`). The SDK does selection/frame UI, pixel prep, progress, one undo step, cancellation via `AbortSignal`. Handlers return `{ src }` (data URL ok, no blob:), aspect within 2%. Docs: https://polotno.com/docs/ai-image-tools
   - Handler (renderer) → IPC `agent:imageEdit` → main writes image/mask PNGs to temp → provider runs a **separate ephemeral thread** (not the chat) with `localImage` inputs + a fixed instruction, image_generation on → reads the generated file → returns a data URL. `signal` abort → `turn/interrupt`.
   - Main post-processes so results always fit: resize to the request size; for Replace/Remove composite the result back only inside the mask (pixels outside stay exact); for Expand pad with `padImageForFrame` and composite the original back. Image models output fixed sizes (e.g. 1024/1536), so this step is required to pass the 2% aspect check.
   - Availability: always register the handlers; when no capable agent is ready, open the setup/instructions dialog and throw `AbortError` (SDK shows no error). Capability check: provider signed in + `modelProvider/capabilities/read` → `imageGeneration`.
   - Per tool: Generative fill (replace/remove) and Expand — agent image edit. Remove background — try agent (transparent output), fall back to an on-device model if quality is poor. Upscale — image models can't truly upscale; hide unless a provider offers it.
   - Claude has no image generation, so with Claude as the provider these tools stay on Codex (or are unavailable). Make the image-tool provider separate from the chat provider.
   - Spike first: quality of mask adherence and remove-background with Codex's image tool.

## Phase 4 — Provider and model choice (done 2026-10-15, see PROGRESS)

1. **Model picker.** `model/list` → dropdown in the panel header; pass `model` on `turn/start`; remember per app (and show which model is in use).
2. **Provider abstraction.** Extract an `AgentProvider` interface from session.ts (status, signIn, run, steer, stop, reset, listModels, events → shared `AgentEntry` feed); rename `codex:*` IPC to `agent:*`. Codex is provider #1.
3. **Claude Code provider.** Candidates: Claude Agent SDK / `claude -p --output-format stream-json` with our MCP server injected via `--mcp-config`, tools locked to the polotno server. Then opencode (has a server/ACP mode). Consider ACP as the common protocol if both support it — verify current docs first.
4. **Setup guidance.** Detect installed + signed-in per provider; empty state with install/login steps for each (the "missing"/"signedOut" states exist for Codex only).
5. **Decision 2026-10-14:** Claude is the next provider after Codex.
6. Licensing gates remain (BACKLOG: SIWC for Codex, Anthropic confirmation for spawning claude).

## Phase 5 — Agent visibility (tldraw-style) (done 2026-10-15, see PROGRESS)

1. **Agent cursor.** On each mutating MCP command, the renderer gets the element id(s); animate a colored "agent cursor" overlay (absolutely positioned over the workspace, in canvas coords via `store.scale`/page offset) gliding to the element, plus a brief highlight outline. Reading commands can show a scanning shimmer over the page.
2. Status chip on the canvas ("Codex is editing 'Title'…").
3. Respect reduced motion.

## Phase 6 — Token/speed optimizations (validate each with a measured before/after run)

From the agent's own list, the ones that look valid and cheap:
- Compact `get_design_json`: omit Polotno default values (the schema knows defaults), keep ids stable. Keep full JSON behind a flag.
- Assets already elided (79f7fd1) — extend to long SVG `src`.
- One "inspect" call returning compact JSON + render + lint; one "edit" call that applies ops and returns render + lint.
- Partial updates already exist (`update_element`); Phase 2 makes `patch_design_json` partial in application too.
- tldraw's idea: full detail for the current page/selection, summaries for other pages.
- Bigger bet (tldraw "code mode"): let the agent run a small JS script against a sandboxed store API. Defer; needs a security design.

## Phase 7 — Several chats per design (exploration only)

Codex threads are already per doc; multiple chats = list of threads per docId with a chat switcher in the panel header (thread/list, thread/name/set exist), and persistence via thread resume (BACKLOG: conversations are ephemeral). Two agents editing one design at once makes Phase 2 mandatory. Recommend: chat history/resume first, parallel chats later if wanted.

## Non-AI items (separate track)

1. **Side panel selection per tab:** save `store.openedSidePanel` per docId on change, pass it as `defaultSection` on remount (or stop remounting the SidePanel). Lift Templates' Library/My designs toggle into a per-app store.
2. **Templates panel:**
   - Multi-select + bulk delete (checkbox mode or shift-click, one confirm).
   - "New design" keeps the panel open in My designs and shows the new item highlighted/animated in.
   - Previews: regenerate the thumbnail on save and on tab switch away (debounced), not realtime.
   - Highlight the currently open design(s) (badge "Open" / ring).

## Suggested order

1. Phase 1 (1–4) + non-AI side panel fix — quick wins, a day or two.
2. Phase 2 — fixes the most damaging bug; needs care and tests.
3. Phase 3.1–3.2 — images flow end to end.
4. Phase 4.1 model picker (tiny), then 4.2–4.4 providers.
5. Phase 5 visuals, Phase 6 optimizations (measured), templates panel.
6. Spikes: canvas AI tools backend, multi-chat.
