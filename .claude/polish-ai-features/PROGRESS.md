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
