# Importing existing files

Turn a user's existing file into an editable Polotno design. Fidelity is
good but never pixel-perfect — always render and check after import.

| Format | Package | Runs in | Entry |
|---|---|---|---|
| PDF | `@polotno/pdf-import` | browser + Node | `pdfToJson({pdf})` |
| PSD | `@polotno/psd-import` | browser + Node | `psdToJson({psd})` |
| SVG | `@polotno/svg-import` | **browser only** (needs a DOM) | `svgToJson({svg})` |
| Figma | via SVG | browser only | export the frame as SVG (keep "Outline Text" OFF), then `svgToJson` |

Notes:

- The Polotno desktop app opens `.pdf` and `.svg` files directly — in the
  app runtime, just `open` the file instead of importing by hand.
- SVG import cannot run in plain Node scripts (no DOM). Headless runtime:
  hand the file to a browser context or the app, or tell the user.
- After any import: `validate`, `render`, and fix — imported text sizing
  and fonts are the usual casualties.

## Never claim

- PPTX **import** — not first-party yet (`@polotno/pptx-export`, the other
  direction, exists).
- IDML (InDesign) import — no supported path.
