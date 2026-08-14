# Polotno design format (authoring cheat-sheet)

The canonical shape `store.toJSON()` produces and `store.loadJSON()` accepts. This
is a practical subset for authoring — `scripts/validate.js` (via `@polotno/schema`)
is the **single source of truth** for validity. When unsure about a property, search
the `polotno_documentation` MCP tool or the published JSON Schema rather than
guessing. Current format is **schemaVersion 4**.

You may write **minimal** JSON and rely on `normalizeDesign` (inside validate.js) to
fill defaults — omit anything you don't need to set.

## Root

```json
{
  "schemaVersion": 4,
  "width": 1080,
  "height": 1080,
  "fonts": [],
  "pages": [ /* Page */ ],
  "audios": []
}
```
- Keep `fonts: []` — Polotno auto-loads Google fonts from each element's `fontFamily`.
- `dpi` (default 72) matters for print: author at final pixel size — A4 at
  300dpi = 2480×3508. The export-time `dpi` option only stamps physical-size
  metadata; it does not add pixels.
- For print with bleed, set `bleed` (px) on each page and keep must-not-crop
  content inside a safe margin. Full print guidance: `print-pdf.md`.

## Page

```json
{ "id": "p1", "background": "#ffffff", "children": [ /* elements */ ] }
```
- `background` must be a solid color or gradient — never transparent for a final design.
- For video/animation, `duration` is in ms (a 0-duration page renders nothing).

## Common element properties

`id`, `type`, `x`, `y`, `width`, `height`, `rotation`, `opacity` (0–1), `visible`,
`custom` (your arbitrary data — see bulk slots). All numbers are **plain numbers**
(`40`, not `"40px"`). Keep `x>=0`, `y>=0`, and elements inside the canvas.
Children render in array order — **earlier = behind**. Put backgrounds and scrims
before text.

## Element types

- **text** — `text`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`, `fill`,
  `align` (left/center/right), `lineHeight`, `letterSpacing` (a multiple of
  fontSize, not px or %: 0 normal, 0.05–0.1 subtle, 0.3–0.5 wide caps-spacing).
  Width must hold the text (validate.js will widen/shrink).
- **figure** — `subType` (`rect`, `circle`, `star`, `triangle`, `line`, `diamond`,
  `hexagon`, `blob1`…), `fill`, `stroke`, `strokeWidth`, `cornerRadius`. Use figures
  for backgrounds, color blocks, scrims, dividers, accents — prefer them over photos
  for decoration.
- **image** — `src` (URL or `${photo:query}` placeholder), `cropX/cropY/cropWidth/
  cropHeight` (0–1), `filters` (`{ brightness:{intensity:n}, … }`), `clipPath`.
- **svg** — `src` (URL or `${icon:query}` placeholder), `colorsReplace` to recolor.
- **line**, **gif**, **video**, **table**, **group** (`children`) — see MCP docs.

## Asset placeholders

While authoring, reference images/icons you don't have yet as:
`"src": "${photo:latte art coffee cup}"` or `"src": "${icon:leaf}"`.
Then resolve them with `scripts/resolve-assets.js` (search → look → pick).
- photo query: 3–5 plain words. icon query: 1–2 nouns.

## Known-safe fonts

`scripts/google-fonts.json` holds 1596 valid families; validate.js maps unknown
names to a fallback. Reliable display/body picks: Playfair Display, Montserrat,
Oswald, Bebas Neue, Poppins, Raleway, Abril Fatface, Merriweather, Inter, Lato,
Open Sans, Roboto, Nunito; scripts: Dancing Script, Great Vibes, Pacifico.

## Gotchas

- Plain numbers only; no `"100px"`, no `"forty"`.
- Solid/gradient page background, never transparent.
- Decorative shapes must not cover text — place them before text in `children`, and
  keep low opacity (0.1–0.3) under text.
