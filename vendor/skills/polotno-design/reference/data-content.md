# Charts, tables, and text from data

Compute every position and label from the data in code. A hand-placed bar is
a wrong bar.

## Charts

Polotno has no chart element. Draw a chart from native elements, so that it stays
editable in the editor and in PowerPoint. An `svg` chart becomes a flat picture
in PowerPoint.

**Bars.** One `figure` with `subType: "rect"` per value:

```js
const scale = plotHeight / Math.max(...values); // bars start at zero
const barHeight = value * scale;
const bar = { type: 'figure', subType: 'rect', x, y: baseline - barHeight,
  width: barWidth, height: barHeight, fill, custom: { value } };
```

**Lines.** One `line` element per segment, and a `circle` figure per point:

```js
const segment = { type: 'line', x: x1, y: y1,
  width: Math.hypot(x2 - x1, y2 - y1), height: 4,
  rotation: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, color };
```

**Parts of a whole.** Use a stacked bar: rects side by side, with widths from the
shares. Polotno has no pie or arc figure. If the brief needs a pie, use an `svg`
and say that it is flat in PowerPoint.

Rules for every chart:

- The page title states the finding: "Q4 was the peak at €142M".
- Label values directly, and omit a legend if you can.
- Use one emphasis color for the point that the title names. Other marks use a
  quiet color.
- Keep `custom.value` on each mark, so that a later update can find the data.
- Put a source note on the page for real data.

## Tables

Use the native `table` element. It stays a real table in PowerPoint.

```json
{
  "id": "risk", "type": "table", "x": 96, "y": 260, "width": 1728, "height": 480,
  "rows": 2, "cols": 2, "colWidths": [0.7, 0.3], "rowHeights": [0.5, 0.5],
  "fontSize": 30, "fontFamily": "Inter", "fill": "#0B2545", "cellPadding": 16,
  "borderColor": "#D5DCE5", "borderWidth": 1, "verticalAlign": "middle", "align": "left",
  "cells": [
    { "id": "h0", "type": "tablecell", "text": "Supplier", "fontWeight": "700", "fill": "#FFFFFF", "cellBackground": "#0B2545" },
    { "id": "h1", "type": "tablecell", "text": "Share", "fontWeight": "700", "fill": "#FFFFFF", "cellBackground": "#0B2545" },
    { "id": "r0", "type": "tablecell", "text": "Supplier A" },
    { "id": "r1", "type": "tablecell", "text": "22%" }
  ]
}
```

`cells` is a flat list, row by row, so it holds `rows × cols` entries.
`colWidths` and `rowHeights` are fractions that sum to 1. A cell inherits from
the table. Set a property on a cell only where it differs.

A table row grows when its text does not fit. `render` reports `table-overflow`
with the height the table needs. Repair it in this order: shorten the text, widen
the column, reduce `fontSize` down to the document's body floor, or split the
table across pages. Column widths must suit the data, so give text columns more
width than number columns.

## Text that varies

Set the behavior on each text element whose content comes from data, a
translation, or a user:

```json
{ "textOverflow": "fit", "minFontSize": 24, "maxFontSize": 56, "fontSize": 56 }
```

| Field | Result |
|---|---|
| `textOverflow: "fit"` | Draws the largest size that fits between the bounds. `fontSize` stays unchanged, so short text grows back. Every renderer does the same |
| `minFontSize` | The floor. Set it at the smallest legible size. Without it, text can shrink to 1px |
| `maxFontSize` | The ceiling. Defaults to `fontSize` |
| `maxLines` | Caps visible lines. Extra text ends in an ellipsis |
| `textOverflow: "ellipsis"` | Cuts the text at the box |

Without a `textOverflow` value, the result depends on the renderer: the editor
grows the box, and the server shrinks the font. `render.js` follows the editor.
Its `overflow` report names the case:

| Kind | Meaning | Repair |
|---|---|---|
| `text-overflow` | Text does not fit its box | Enlarge the box, reduce the text, or add `fit` |
| `fit-floor` | Text does not fit even at `minFontSize` | Shorten the text, or split it |
| `table-overflow` | A table needs more height | See Tables |
| `text-cut` | An ellipsis or `maxLines` hides text | Accept it only if the cut is deliberate |

## Data-heavy and long content

Decide the page count from the data. Split a table or a list across pages before
the text falls below the body floor. Repeat the header row on each page. Summarize
for a deck, and keep full tables for a report or an appendix page. Long text
flows across pages only by your split: a text element has no page overflow.

## Translated text

- Allow for growth: German and Russian run about 30% longer than English. Use
  `fit` on every translated element, then read the overflow report.
- Use a font for the script. Latin fonts have no CJK, Thai, or Indic glyphs.
  These look correct on a laptop through system fonts, and become empty boxes on
  a server. `lint` reports `font-script`. Use Noto Sans JP, KR, SC, Thai, or
  Devanagari, for example.
- For Arabic and Hebrew, set `align: "right"` and mirror the layout where the
  reading order depends on it.
