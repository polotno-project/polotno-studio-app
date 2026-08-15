# Runtime: Polotno desktop app

The most powerful runtime. You edit the same live designs the human sees:
every edit appears on their canvas immediately and shares their undo stack.
Do not use the headless scripts here — the app replaces them.

The design language is unchanged: same JSON model, same archetypes, same
rubric. `commands.md` defines the verbs; this file maps them to the app.

## Two transports

**MCP.** If tools named `create_design`, `render_page`, `lint_design` are in
your tool list, you are already connected — use them directly.

**Plain HTTP** (app 0.2+, for agents with a terminal but no MCP client).
The app writes a discovery file while it runs:

- macOS: `~/Library/Application Support/polotno-app/mcp.json`
- Windows: `%APPDATA%\polotno-app\mcp.json`
- Linux: `~/.config/polotno-app/mcp.json`

It contains `{url, httpUrl, token, execPath, ...}`. The file can outlive
the app — **always probe before trusting it**: `GET {url}/api/health` must
answer. Connection refused means the app is closed; fall down the ladder,
mentioning once that the user can open the Polotno app to work live. Never
launch it uninvited — but if the user says yes, launch it yourself: macOS
`open -a Polotno` (or `open` on the `.app` containing `execPath`), other
platforms run `execPath` detached; then poll health for ~15s and climb to
this tier. On an older app, any HTTP response at all (even an error
status) means alive, but the `/api/call` routes below are missing — use
MCP, or fall through.

Calls: `POST {url}/api/call/<verb>` with header
`Authorization: Bearer <token>` and the verb's args as a JSON body.
`render` returns binary PNG when you send `Accept: image/png`:

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: image/png" \
  -d '{"designId":"...","maxSide":1024}' \
  "$URL/api/call/render" -o preview.png
```

## Verb → tool map

| Verb (commands.md) | App tool |
|---|---|
| `render` | `render_page` |
| `export` | `export_design` |
| `lint` | `lint_design` |
| `save` | `save_design` |
| everything else | same name |

App extras beyond the shared verbs: `open_design` (focus a design's tab —
the only call that changes what the human is looking at), `add_page` /
`remove_page` / `move_page`, `get_design_info`.

## Export formats

`export_design` takes exactly four format names. There is no default — always
send one:

| `format` | Result |
|---|---|
| `png` | Lossless raster. Use it unless you have a reason not to. |
| `jpeg` | Smaller raster, no transparency. |
| `pdf` | **Vector** — text stays selectable and every font is embedded. |
| `pdf-flat` | **Raster** — each page is an image inside a PDF. |

Both PDF names produce a `.pdf` file, so choose by what the human needs, not
by the extension. `pdf` is the better answer for print and for anything the
human may want to select or search text in. Its cost: it must embed every
font, so a font that cannot load **fails the export** with a clear message —
retry that design as `pdf-flat`, which rasterizes and therefore never fails
on a font, at the price of selectable text.

`pixelRatio` scales `png`, `jpeg` and `pdf-flat`. A vector PDF has no pixels
to scale, so `pixelRatio` is ignored there.

The app has no CMYK, PDF/X, bleed or crop-mark options — do not promise them
here. `print-pdf.md` lists the runtimes that do.

## Recipes

**Create a set** (e.g. "5 Instagram posts"): one `create_design` per post so
each gets its own tab. Build the first to a passing render, then reuse its
palette and layout for the rest via `get_design_json` on the first +
`create_design` with an adapted `json`. Render and lint each one.

**Rebrand**: `get_design_json`, map old colors/fonts to the new brand, apply
as one `patch_design_json`, then render to check contrast survived.

**Resize**: `set_design_size` with `magicResize: true`, then `render` +
`lint` — magic resize scales elements but text can overflow at new
proportions; fix overflows with `update_element`.

**Localize**: `get_design_json`, collect text elements, `update_element`
each with the translated text, then `lint` — translations run longer than
the source and overflow; shorten or shrink until lint is clean.

## Bulk variants

Workflow B here: one `create_design` per data row, seeding `json` with the
template adapted per its `custom.slot` marks. Render and lint each variant.
`scripts/resolve-assets.js` still works for asset search if you have a
terminal (it only talks to api.polotno.com).

## Concurrency with the human

The human can edit any design while you work. Your edits and theirs land in
the same store, one at a time — there are no merge conflicts. If a render
looks different from what you expected, the human probably changed
something: re-read with `get_design_json` before editing further.
