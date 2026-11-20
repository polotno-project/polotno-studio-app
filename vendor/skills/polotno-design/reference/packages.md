# Polotno package catalog

What exists, in one line each, and where this skill uses it. For API
details on any of them, use the `polotno-sdk` skill / Polotno docs search —
this skill never duplicates API reference.

| Package | What | Used by |
|---|---|---|
| `polotno` | the editor SDK (React) | app, local server, studio |
| `polotno-node` | headless PNG, JPEG, raster PDF, GIF, and MP4 via bundled Chromium. Draws video frames and, from 3.17.0, Lottie | `render.js` |
| `@polotno/image-export` | PNG and JPEG with no headless browser (Node.js 22.13+). Does not draw video frames or Lottie | your own pipeline. `render.js` uses polotno-node |
| `@polotno/schema` | design JSON types, validate, normalize + JSON schema. `@polotno/schema/variables`: `getVariables`, `resolveVariables` | `validate.js`, `lint.js`, `from-template.js`, all runtimes |
| `@polotno/pdf-export` | vector + print-ready PDF (PDF/X, CMYK, spot colors) | `render.js --vector`, `print-pdf.md` |
| `@polotno/pdf-import` | PDF → editable design | `import.md` |
| `@polotno/psd-import` | PSD → editable design | `import.md` |
| `@polotno/pptx-import` | PowerPoint → editable design | `import.md` |
| `@polotno/svg-import` | SVG/Figma → editable design (browser only) | `import.md` |
| `@polotno/svg-export` | design → SVG | export option |
| `@polotno/html-export` | design → HTML | export option |
| `@polotno/pptx-export` | design → editable PowerPoint | `render.js`, `pptx.md` |
| `@polotno/video-export` | design → MP4 from a live store in a browser | embedded editors. `render.js` uses polotno-node |

Template variables, `bindings`, `fit`, and `focus` need `polotno` 4.22.1,
`polotno-node` 3.19.1, `@polotno/pdf-export` 0.18, and `@polotno/pptx-export`
0.14 or later. The scripts install these. An older editor drops them on save,
and an older renderer prints each `{{name}}` as written.

Hosted: the **Cloud Render API** (`api.polotno.com/api/renders`) renders
design JSON to png/jpeg/pdf/gif/mp4/pptx server-side — see
`runtimes/backend.md` and `print-pdf.md`.
