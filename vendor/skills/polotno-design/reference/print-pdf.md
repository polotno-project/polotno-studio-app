# PDF and print output

Read this before promising any print output. Polotno has three PDF paths
with different capabilities; claiming a feature the chosen path lacks is a
bug.

## Which path?

| Need | Use |
|---|---|
| Screen/office PDF (raster pages is fine) | polotno-node (`render.js --pdf`) |
| Vector PDF (selectable text), print-ready: CMYK, PDF/X, spot colors | `@polotno/pdf-export` |
| No local Chromium / server-side batch | Cloud Render API |
| Either kind, from a design the human has open | Polotno desktop app (`runtimes/local-app.md`) |

The desktop app gives both kinds under two format names — `pdf` is vector,
`pdf-flat` is raster — but none of the print options below. For CMYK, PDF/X,
bleed or crop marks, use `@polotno/pdf-export` or the Cloud Render API.

## Raster PDF — polotno-node (`render.js --pdf`)

Pages are rendered as images and wrapped in a PDF. Options: `dpi`, `unit`
(`pt`/`mm`/`cm`/`in`), `pageIds`, `parallel`, `cropMarkSize`,
`includeBleed`. Good enough for handouts and proofs. **Not vector, no
CMYK, no PDF/X** — text is pixels.

## Vector + print-ready PDF — `@polotno/pdf-export`

Node and browser (`@polotno/pdf-export/browser`) entries. Real vector
output plus the print features:

- `pdfx: 'x-4' | 'x-1a'` — PDF/X output. **Requires `outputIntent`**
  (an ICC profile + identifier); PDF/X without an output intent is invalid.
- `colorMode: 'cmyk'` (PDF/X-4 only) — vector colors convert to CMYK
  in-process. Raster images stay ICC-tagged RGB.
- `spotColors: [{name, cmyk, overprint}]`.
- `includeBleed` — reads `page.bleed` from the design JSON; `cropMarkSize`.
- `dpi`, `imagePpi` (default 300), `imageQuality`, `metadata`.

Node usage: `jsonToPDF(json, path, options)` / `jsonToPDFBytes`. In the
browser the CSP needs `wasm-unsafe-eval` (color conversion runs in wasm).

## Cloud Render API

`POST https://api.polotno.com/api/renders?KEY=…` (paid). PDF-relevant
options: `vector: true` (alpha — uses pdf-export server-side), `pdfx`,
`color: {space: 'CMYK', profile: 'FOGRA39' | 'USWebCoatedSWOP'}`,
`includeBleed`, `dpiMetadata`. CMYK is rejected for png/gif output.

## Authoring for print

- **Canvas size**: author at final pixel size for the target dpi —
  A4 at 300dpi = 2480×3508 px. The export `dpi` option only stamps
  physical size metadata; it does not add pixels. Two different levers —
  don't confuse them.
- **Bleed**: set `page.bleed` (px) in the design JSON and keep all
  must-not-crop content inside a safe margin; export with `includeBleed`
  (+ `cropMarkSize` when the printer wants marks).
- Ask the printer what they need (plain PDF vs PDF/X, profile) before
  choosing options — don't default to PDF/X.

## Never claim

- Vector or CMYK PDF from polotno-node — its PDF is raster, always.
- CMYK png/gif — no path supports it.
- PPTX/IDML *import* (export to PPTX exists; see `import.md`).
- `textOverflow: 'ellipsis'` in PDF export — unsupported there.
