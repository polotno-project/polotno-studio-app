# Runtime: Polotno desktop app

If the desktop app is connected, use this runtime. Each edit appears on the
user canvas and shares the app undo stack. Do not use the headless scripts.

The design language is unchanged. All runtimes use the same JSON model,
layout recipes, and proof checks. `commands.md` defines the verbs. This file
maps them to the app.

## Two transports

**MCP.** If `create_design`, `render_page`, and `lint_design` exist, use them
directly.

**Plain HTTP** (app 0.2+, for agents with a terminal but no MCP client).
`node scripts/find-app.js` reports whether the app is running. The app writes a
discovery file while it runs:

- macOS: `~/Library/Application Support/polotno-app/mcp.json`
- Windows: `%APPDATA%\polotno-app\mcp.json`
- Linux: `~/.config/polotno-app/mcp.json`

It contains `{url, httpUrl, token, execPath, ...}`. The file can outlive
the app — **always probe before trusting it**: `GET {url}/api/health` must
answer. Connection refused means the app is closed. Use the next runtime,
and tell the user once that the app gives live editing. Do not launch the app
without approval. If the user approves, launch it. On macOS, use
`open -a Polotno`. On other platforms, run `execPath` detached. Then poll
health for approximately 15 seconds. If the health URL answers, use this tier.

An older app can return an error from the health URL. This means that the app
is open, but the HTTP call routes are absent. Use MCP or the next runtime.

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

Both PDF names produce a `.pdf` file. Select the format from the output need.
If text must remain selectable, use `pdf`. This format must embed every font.
If a font cannot load, correct its source. If raster text is acceptable, use
`pdf-flat`.

`pixelRatio` scales `png`, `jpeg` and `pdf-flat`. A vector PDF has no pixels
to scale, so `pixelRatio` is ignored there.

The app has no CMYK, PDF/X, bleed or crop-mark options — do not promise them
here. `print-pdf.md` lists the runtimes that do.

`render` shows one page. For a design with several pages, render each page id.

### PowerPoint, GIF, and MP4

`export_design` has none of these. Write the output of `get_design_json` to a
file, and run `node scripts/render.js design.json out.pptx` (or `out.gif`,
`out.mp4`). Without a terminal, tell the user to use the app's Download menu for
GIF and video.

## Recipes

**Create a set:** Use one `create_design` call for each design. Build the first
design until its proof passes. Then reuse its tokens and layout. Render and
run `lint` on each design.

**Apply a brand:** Read the JSON. Map each visual role to a supplied brand
value. Apply one JSON patch. Then view the render and make sure that contrast
is sufficient.

**Resize**: `set_design_size` with `magicResize: true`, then `render` +
`lint` — magic resize scales elements but text can overflow at new
proportions. Fix overflows with `update_element`.

**Localize:** Read the JSON. Update the applicable text elements. Then run
`lint`. If text overflows, adjust its box or type size. Do not change meaning
only to make the text fit.

## Bulk variants

Fill the template once for each data row: see the bulk variant in
`transformations.md`. Use one `create_design` call for each filled design.
Render and run `lint` on each variant.
`scripts/resolve-assets.js` still works for asset search if you have a
terminal (it only talks to api.polotno.com).

## Concurrency with the human

The human can edit any design while you work. Your edits and theirs land in
the same store, one at a time — there are no merge conflicts. If a render
looks different from what you expected, the human probably changed
something: re-read with `get_design_json` before editing further.
