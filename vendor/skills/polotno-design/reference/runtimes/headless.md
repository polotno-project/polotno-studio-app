# Runtime: headless (scripts)

No app, no human watching, or a bulk/unattended job. Everything runs from
the terminal against `design.json` files.

The scripts install missing npm packages and check for permitted updates at most
once every seven days. The PowerPoint and vector PDF exporters install on first
use. Set `POLOTNO_DEPENDENCY_UPDATE=never` to disable update checks.

Rendering and asset search need a Polotno key. The scripts bundle a public
demo key; set your own to use it instead:

```bash
export POLOTNO_API_KEY=...   # https://polotno.com/cabinet
```

## Verb → script map

| Verb | How |
|---|---|
| create/read/patch design | edit `design.json` directly |
| schema validation | `node scripts/validate.js design.json` (read-only partial validation) |
| `lint` | `node scripts/lint.js design.json` |
| `render` (preview) | `node scripts/render.js design.json preview.png` (~512px). Several pages write `preview-1.png`, `preview-2.png`, and so on |
| `export` | `node scripts/render.js design.json` with `out.png --full`, `out.pdf`, `out.pdf --vector`, `out.pptx`, `out.gif`, or `out.mp4`. `--page <id>` selects one page |
| assets | `node scripts/resolve-assets.js search photo "…"` — look, pick, paste the url. Icons: `search icon "…"` then `get icon <id>` → paste the data URL. `resolve` mode auto-picks for unattended runs |

`render.js` prints a JSON report. Its `overflow` list gives each text or table
that does not fit, measured in the real renderer. Fix each entry.

If a font cannot load, `render.js` stops. Correct the font source before you
make a new proof or final export.

If this machine cannot run Chromium, use the Cloud Render API: see `backend.md`.

## If you cannot view images

You cannot run the loop. Author and validate the JSON, render once, and
tell the user that visual proof was not possible. Do not describe an unseen
render as correct.
