# Runtime: headless (scripts)

No app, no human watching, or a bulk/unattended job. Everything runs from
the terminal against `design.json` files.

## Setup (once per project)

```bash
cd scripts && npm install && cd ..
```

Rendering and asset search need a Polotno key. The scripts fall back to a
public demo key (rate-limited, fine for iterating). For real use:

```bash
export POLOTNO_API_KEY=...   # https://polotno.com/cabinet
```

## Verb → script map

| Verb | How |
|---|---|
| create/read/patch design | edit `design.json` directly |
| `lint` (structural) | `node scripts/validate.js design.json` — repairs what it can, reports the rest |
| `render` (preview) | `node scripts/render.js design.json preview.png` (~512px) |
| `export` | `node scripts/render.js design.json out.png --full` · `out.pdf --pdf` · `--page <id>` |
| assets | `node scripts/resolve-assets.js search photo "…"` — look, pick, paste the url. Icons: `search icon "…"` then `get icon <id>` → paste the data URL. `resolve` mode auto-picks for unattended runs |

Print options for `--pdf` (dpi, units, bleed, crop marks) and the vector /
CMYK / PDF-X story live in `print-pdf.md` — read it before promising any
print output.

## No local Chromium? Cloud Render API

`render.js` runs a headless Chromium via polotno-node. If the machine
cannot run one, the Cloud Render API renders the same JSON server-side
(paid key required):

```bash
curl -s -X POST "https://api.polotno.com/api/renders?KEY=$POLOTNO_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"design": <design.json contents>, "format": "png"}'
# → {"id": "..."} ; poll:
curl -s "https://api.polotno.com/api/renders/<id>?KEY=$POLOTNO_API_KEY"
# → {"status": "done", "output": "<url, valid 7 days>"}
```

Formats: png, jpeg, pdf, gif, mp4. Print options: see `print-pdf.md`.
Full docs: https://polotno.com/docs/cloud-render-api

## Bulk variants

Per Workflow B: copy the template per data row, fill each `custom.slot`
element from the row, `validate.js`, then `render.js … --full` to a
per-row output file. Name outputs from a stable row key, and report any
rows that dropped elements — never report a clean batch silently.

## If you cannot view images

You can't run the loop. Author and validate the JSON, render once, and
tell the user plainly the design was not visually verified — never claim
it looks good when you never saw it.
