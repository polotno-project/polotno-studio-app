# Polotno design format (authoring cheat-sheet)

The canonical shape `store.toJSON()` produces and `store.loadJSON()` accepts.
This file gives a practical authoring subset. `scripts/validate.js` uses
`@polotno/schema` as the source of truth. If a property is unclear, search the
Polotno documentation or the published JSON Schema.

You can write minimal JSON and omit unused defaults. The default validation mode
accepts this partial form and does not edit the file. If canonical JSON is
required, use `validate.js design.json --normalize canonical.json`.

The normalization report lists removed and changed paths. Review these paths
before you use the canonical output.

## Root

```json
{
  "schemaVersion": 5,
  "width": 1080,
  "height": 1080,
  "fonts": [],
  "pages": [ /* Page */ ],
  "audios": []
}
```
- `schemaVersion` is required. Polotno reads a missing version as the oldest
  format and rewrites letter spacing, filters, and animations. `validate.js`
  rejects it.
- Keep `fonts: []` for Google fonts. Polotno loads them from each element's
  `fontFamily`. Any other font needs an entry: see `templates-brand.md`.
- `dpi` (default 72) matters for print: author at final pixel size — A4 at
  300dpi = 2480×3508. The export-time `dpi` option only stamps physical-size
  metadata. It does not add pixels.
- For print with bleed, set `bleed` (px) on each page and keep must-not-crop
  content inside a safe margin. Full print guidance: `print-pdf.md`.
- `variables` (optional) describes the template variables: see
  `templates-brand.md`.

## Page

```json
{ "id": "p1", "background": "#ffffff", "children": [ /* elements */ ] }
```
- `background` must be a solid color or gradient — never transparent for a final design.
  A gradient, here or in `fill`, is `linear-gradient(90deg, #000000 0%, #ffffff 100%)`.
- `duration` (ms, default 5000) sets the page time in GIF and video.

## Common element properties

Common properties are `id`, `type`, `x`, `y`, `width`, `height`, `rotation`,
`opacity`, `visible`, `href`, `bindings`, and `custom`. Use plain numbers such
as `40`, not `"40px"`. Keep elements inside the canvas. Children render in array
order. Earlier children stay behind later children. Put backgrounds and scrims
before text.

- `bindings` connects a property to a template variable, for content that
  changes per page or per data row: see `templates-brand.md`.
- `custom` holds the skill's own data, such as `custom.repeat`.
- `href` makes an element or group a link: `https:`, `mailto:`, `tel:`, or
  `#<page id>`. In rich text, `<a href="…">` links words. PDF, PowerPoint, SVG,
  and HTML exports keep links. PNG, GIF, MP4, and PDF/X have none.

## Element types

- **text** — Use `text`, `fontSize`, `fontFamily`, `fontWeight`, `fontStyle`,
  `fill`, `align`, `lineHeight`, and `letterSpacing`. Letter spacing is a
  font-size multiple, not pixels or a percentage. The default `align` is
  `center`. `{{name}}` in `text` prints a template variable. Set a box that
  holds the text. `lint.js` estimates fit. `render.js` measures it, and the
  measurement decides.
- **figure** — Use `subType`, `fill`, `stroke`, `strokeWidth`, and
  `cornerRadius`. Common subtypes include `rect`, `circle`, `star`, `triangle`,
  `line`, `diamond`, `hexagon`, and `blob1`. Use figures for decorative fields,
  scrims, dividers, and accents.
- **image** — `src` (URL or `${photo:query}` placeholder), `cropX/cropY/cropWidth/
  cropHeight` (0–1), `filters` (`{ brightness:{intensity:n}, … }`), `clipSrc`.
  `fit: "cover"` or `"contain"` crops any source to the frame when it draws, and
  `focus: { x, y }` (0–1) picks the part that stays in view.
- **svg** — `src` (URL or `${icon:query}` placeholder), `colorsReplace` to recolor.
- **line** — `color`, and `height` as its thickness. **table**: see
  `data-content.md`. **gif**, **video**, **group** (`children`): see the Polotno
  documentation.

## Asset placeholders

While authoring, reference images or icons that you do not have as:
`"src": "${photo:latte art coffee cup}"` or `"src": "${icon:leaf}"`.
Then resolve them with `scripts/resolve-assets.js` (search → look → pick).
- photo query: 3–5 plain words. icon query: 1–2 nouns.

## Known-safe fonts

`scripts/google-fonts.json` holds the known Google font families. `lint.js`
reports an unknown family. It never replaces a font. Reliable display/body
picks include Playfair Display, Montserrat, Oswald, Bebas Neue, Poppins,
Raleway, Abril Fatface, Merriweather, Inter, Lato,
Open Sans, Roboto, and Nunito. Script choices include Dancing Script, Great
Vibes, and Pacifico.

## Gotchas

- Use plain numbers only. Do not use `"100px"` or `"forty"`.
- Solid/gradient page background, never transparent.
- Decorative shapes must not cover text — place them before text in `children`, and
  keep low opacity (0.1–0.3) under text.
