# Polotno App

Free desktop design editor for Mac, Windows, and Linux. Local-first: designs
are local JSON files, no accounts. Stock media, templates, and Google Fonts
load from the network; a true offline mode is planned for later.

The app has a built-in MCP server. Any AI agent (Claude, Cursor, Codex, …) can
create, edit, see, and export designs while you edit the same designs in the
editor. Agent edits and your edits share one undo stack.

## Development

```bash
npm install
npm run dev          # editor with hot reload
npm run build        # typecheck + build app, MCP server, and .mcpb bundle
npm run build:unpack # packaged app in dist/ for a local smoke test
```

Set `VITE_POLOTNO_KEY` to your Polotno license key. Register the domain
`electron` for that key at https://polotno.com/cabinet — the packaged app runs
on `file://`, which the SDK reports as origin `electron`.

## Connect an AI agent

Open the app and click **Connect AI**. The app runs a local MCP server at
`http://127.0.0.1:41414/mcp`, protected by a per-install token. The app must be
running to serve agents.

| Client | How |
| --- | --- |
| Claude Desktop | **Download for Claude Desktop (.mcpb)**, then double-click the file |
| Claude Code | **Copy Claude Code command**, then paste it in a terminal |
| Cursor | **Add to Cursor** |
| VS Code | **Add to VS Code** |
| Any MCP client | **Copy config JSON** (streamable HTTP + `Authorization: Bearer <token>`) |

Agents get 19 tools (create/edit/render/lint/export) and the bundled
`polotno-design` skill as MCP resources under `polotno://skill/`.

## Headless CLI

The same binary renders and lints without a window:

```bash
polotno render design.json -o out.png [--page 2] [--pixel-ratio 2]
polotno render a.json b.json -o outdir/ [--format png|jpeg|pdf]
polotno lint design.json [--json]
```

Exit codes: 0 ok, 1 render failure, 2 bad arguments, 3 invalid design JSON,
4 lint found errors.

## File format

One design = one JSON file (`.polotno`, plain JSON). The content is exactly
`store.toJSON()` from the Polotno SDK. `@polotno/schema` documents and
validates the format. Assets are URLs or data URLs inside the file.

Designs without a file autosave as drafts and come back on the next launch.
File-backed designs autosave to their file (about 1 s after a change).

## Repository layout

- `src/main` — Electron main process: files, tabs registry, bridge router, MCP launcher, CLI
- `src/preload` — typed `window.desktop` IPC bridge
- `src/renderer` — Polotno editor, tabs, executor, lint
- `src/mcp-server` — MCP server (runs as a utilityProcess, bundled by esbuild)
- `src/shared` — IPC + command contracts (single source of truth)
- `mcpb/` — Claude Desktop bundle (stdio proxy + manifest)
- `vendor/skills` — pinned copy of the `polotno-design` skill (`scripts/sync-skills.mjs`)
- `scripts/` — font pack, template previews, MCP/mcpb builds, skill sync
