# Vector PDF export fails for Arial designs

Status: done (branch nikigan/fix-vector-pdf-arial).

## Cause
@polotno/pdf-export <= 0.11 browser build: its pdfkit `fs` shim bundled only
Helvetica.afm, so any base-14 font besides regular Helvetica threw
`Standard font "Helvetica-Bold" is not available in this build` (FONT_FAILED).
Arial maps to Helvetica(-Bold), so every bundled template failed.

## Fix
Upgraded @polotno/pdf-export ^0.8.1 -> ^0.13.0. The browser build now lazy-loads
all base-14 AFM metrics from lib/standard-fonts.js (a separate ~580 KB chunk in
out/renderer, bundled locally — no network). jsonToPDFBlob API unchanged.
Chose this over app-side Arimo/Tinos/Cousine substitution: no app code, no
Google Fonts fetch, and base-14 fonts stay unembedded (smaller PDFs).

## Verified
- `npm run typecheck` passes.
- `electron . render <template>.json -o x.pdf` (same executor -> jsonToPDFBlob
  path as Export > PDF): social-media-post and basic-poster export; text
  extracts with pypdf; fonts Helvetica/Helvetica-Bold; render matches PNG.
- welcome.json still fails: it uses "Monaco" (macOS system font, not on Google
  Fonts) — separate issue, in BACKLOG.md.

## Follow-up: all Polotno packages bumped to latest (2026-09-28)
polotno 4.8.0 -> 4.14.1, @polotno/pdf-import 0.5.0 -> 0.9.0, @polotno/schema
0.6.0 -> 0.7.0, @polotno/svg-import 0.0.25 -> 0.2.2, @polotno/video-export
0.2.3 -> 0.4.0 (pdf-export already 0.13.0). All share @polotno/core 0.13.0
except video-export 0.4.0, which pins core 0.12.0 upstream.
Verified: typecheck; CLI render png/jpeg/pdf/pdf-flat of templates; in the
built renderer over CDP (isolated --user-data-dir): openPath on a PDF and an
SVG imports them, storeToVideo returns a video/mp4; validateDesign (schema
0.7.0) accepts all templates and rejects bad input; build:mcp bundles.
