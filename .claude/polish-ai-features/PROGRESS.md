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
