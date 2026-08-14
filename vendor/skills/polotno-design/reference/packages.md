# Polotno package catalog

What exists, in one line each, and where this skill uses it. For API
details on any of them, use the `polotno-sdk` skill / Polotno docs search —
this skill never duplicates API reference.

| Package | What | Used by |
|---|---|---|
| `polotno` | the editor SDK (React) | app, local server, studio |
| `polotno-node` | headless rendering via bundled Chromium | `render.js` (headless) |
| `@polotno/schema` | design JSON types, validate, normalize + JSON schema | `validate.js`, all runtimes |
| `@polotno/pdf-export` | vector + print-ready PDF (PDF/X, CMYK, spot colors) | `print-pdf.md` paths |
| `@polotno/pdf-import` | PDF → editable design | `import.md` |
| `@polotno/psd-import` | PSD → editable design | `import.md` |
| `@polotno/svg-import` | SVG/Figma → editable design (browser only) | `import.md` |
| `@polotno/svg-export` | design → SVG | export option |
| `@polotno/html-export` | design → HTML | export option |
| `@polotno/pptx-export` | design → PowerPoint | export option |
| `@polotno/video-export` | design → MP4 (browser, live store) | export option |

Hosted: the **Cloud Render API** (`api.polotno.com/api/renders`) renders
design JSON to png/jpeg/pdf/gif/mp4 server-side — see `runtimes/headless.md`
and `print-pdf.md`.
