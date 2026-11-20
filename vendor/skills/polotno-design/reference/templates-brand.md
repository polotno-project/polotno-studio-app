# Templates, brand rules, and custom fonts

## Build from a template

A template is a Polotno design whose pages are layouts. Its elements hold the
customer's look. Template variables mark the content that changes: a
`{{name}}` token in text or a table cell, or a binding on an element. A new
design reuses the layout pages with new values.

1. **List it.** `node scripts/from-template.js template.json --list` prints each
   layout and its slots: the variables that the page uses. A text slot shows
   `maxChars`, the capacity of its whole box. A slot with `rows` and `cols` is
   in a table. Use this output, and keep the full template JSON out of your
   context.
2. **Prepare it, once.** If the list shows no slots, mark each part that
   changes:

   | Part | Mark |
   |---|---|
   | Text | A token where the value goes: the whole text (`"{{title}}"`) or inline (`"Dear {{first_name}},"`). Add `textOverflow: "fit"` and `minFontSize` |
   | Image, svg, gif, or video | `"bindings": { "src": "photo" }` and `"fit": "cover"`. Keep a sample `src` |
   | Color | `"bindings": { "fill": "accent" }` on a text or figure |
   | Shown or hidden | `"bindings": { "visible": "show_badge" }` on any element or group |
   | Table filled by rows | A token in its first cell, such as `"{{data}}"` |

   Name each page with `custom: { "layout": "<name>" }`, and add
   `custom.repeat` to logos and footers. Describe the variables in the root
   `variables` array: see below. Save this as the template.
3. **Plan it.** Map the storyline to layouts in `plan.json`:

   ```json
   { "pages": [
     { "layout": "cover", "slots": { "title": "Spend control", "subtitle": "CFO review",
       "photo": { "value": "https://images.example.com/team.jpg", "focus": { "x": 0.5, "y": 0.3 } } } },
     { "layout": "table", "slots": { "title": "Top suppliers",
       "data": [["Supplier", "Share"], ["Supplier A", "22%"]] } },
     { "layout": "text", "slots": { "title": "Next steps", "body": "Approve the plan.", "note": null },
       "add": [ { "id": "bar", "type": "figure", "subType": "rect", "x": 96, "y": 900,
                  "width": 400, "height": 8, "fill": "#13A89E" } ] }
   ] }
   ```

4. **Build it.** `node scripts/from-template.js template.json plan.json deck.json`.
   Use a layout as often as you need. Each page gets new element ids.
5. **Check it.** Run `validate`, `lint` with `--brand`, and `render`. Proof every
   page.

| Slot value | Effect |
|---|---|
| String, number, or boolean | The value. A token prints it. A binding sets its property: a URL for `src`, a color for `fill`, `true` or `false` for `visible` |
| Object | `value` is the value. The other keys are set on each element that uses the slot, such as `{ "value": "https://…", "focus": { "x": 0.5, "y": 0.2 } }` |
| Rows array | The cells of each table that uses the slot, header row first. Extra rows repeat the body rows, so stripes continue. The column count stays |
| `null` | Removes each element that uses the slot |

The object, the rows array, and `null` are extras of `from-template.js`.
Polotno's `resolveVariables` and the Cloud Render API have none of them.

Each page is filled on its own, so a slot can take a new value on every page.
The plan must give every slot on a page a value, unless the template gives it a
`default`, so no token or sample image remains by accident. A slot key is the
name that `--list` prints, such as `user.city`. `add` puts extra elements on a
page, such as a chart. The result is a plain design: values in place, with no
bindings and no `variables`. The template's size, fonts, and `custom.brand`
carry over. An older template format is migrated first, and the report says so.

A customer template in PDF or PSD comes through `import.md` first.

### Variables and image crops

The root `variables` array describes each variable. Only `name` is required:

```json
{ "variables": [
  { "name": "title", "label": "Title", "required": true, "value": "Spend control" },
  { "name": "subtitle", "default": "Quarterly review" }
] }
```

- `default` fills a slot that the plan leaves out.
- `required` stops the build when the plan has no value, even with a default.
- `value` is what the design shows now, in the editor and in every export. It is
  a sample: a plan or a data row always replaces it.
- A token or binding with no entry is still a variable.

Crop image slots with `fit` and `focus`, so a source of any shape fills its
frame. Every renderer crops each new source when it draws. `cover` fills the
frame, and `contain` shows the whole source. `focus` holds the part that stays
in view: `x` and `y` from 0 to 1, 0.5 by default, such as `{ "x": 0.5, "y": 0.3 }`
for faces. In the editor, a crop property such as `cropX` switches `fit` off.

## Check brand rules

Store the rules in the template, so they travel with each design:

```json
{ "custom": { "brand": { "colors": ["#0B2545", "#13A89E", "#FFFFFF"], "fonts": ["Inter"] } } }
```

`lint` then reports `brand-color` and `brand-font` errors for every element,
table cell, gradient stop, and page background. Without `custom.brand`, use
`--brand`:

- `lint.js deck.json --brand brand.json` reads the same two lists from a file.
- `lint.js deck.json --brand template.json` allows the colors and fonts that the
  template uses. Use this if the customer gave only a template.

Lint checks colors and fonts only. The visual proof checks logo use and tone.

## Use a custom font

`fonts` declares every font that is not a Google font:

```json
"fonts": [ { "fontFamily": "Acme Sans", "url": "https://cdn.example.com/acme-sans.woff2" } ]
```

For several weights, use `styles`:

```json
"fonts": [ { "fontFamily": "Acme Sans", "styles": [
  { "src": "url(https://cdn.example.com/acme-regular.woff2)", "fontWeight": "normal" },
  { "src": "url(https://cdn.example.com/acme-bold.woff2)", "fontWeight": "bold" }
] } ]
```

| Source | Use |
|---|---|
| `https:` URL with open CORS | Designs that others will open. Use this for delivery |
| `data:` URL | A self-contained file. It makes the JSON large |
| `file:` URL | This machine only, for the scripts. Replace it before you deliver the JSON |

An undeclared font stops the render with `FONT_FAILED`. Add a style for each
weight that the design uses.

PowerPoint files do not embed fonts: see `pptx.md`. If a customer font is not
licensed for embedding, use the raster PDF path.
