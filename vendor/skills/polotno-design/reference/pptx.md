# PowerPoint output

`render.js deck.json deck.pptx` writes an editable PowerPoint file. In the desktop
app, see `runtimes/local-app.md`.

Read this before you author, because a choice in the JSON decides what stays
editable.

## Check it

1. Run `node scripts/lint.js deck.json --target pptx` before export. Each
   `pptx-loss` warning names an element, and what PowerPoint will do to it. The
   exporter itself gives no warning for flattened elements.
2. Run the export. The report gives `shapes`, `tables`, and `pictures` per slide,
   and the exporter's own `warnings`. A slide with a picture you did not place has
   a flattened element.
3. If `soffice` exists, convert the file to PDF and view it. This confirms
   geometry. It is not proof of PowerPoint's own rendering, so name it as a
   LibreOffice check.

Report the file as editable only after step 2.

## What stays editable

| Use this | PowerPoint result |
|---|---|
| Text, with bold, italic, color, lists, line height, spacing | Text |
| Figures: rect, circle, triangle, rightTriangle, diamond, pentagon, hexagon, star, cross, the four arrows, heart1, cloud | Shape |
| `cornerRadius` on a `rect` | Rounded rectangle |
| Lines with dash and arrow heads | Line |
| `table` | Table |
| Image with crop, flip, rotation, opacity, shadow | Picture that can be re-cropped |
| Solid page background | Background |
| Video | Embedded media |

## What degrades

| This choice | Result | Prefer |
|---|---|---|
| `cornerRadius` on a circle or any non-rect figure | Picture | Remove `cornerRadius`. A circle needs none |
| Gradient on a figure or page | Picture | A solid color, or accept it for a background |
| Blob and decorative figures | Picture | A preset figure |
| Blur or filters on a figure | Picture | A solid color with opacity |
| `svg`, including icons and charts | Picture that cannot be recolored | Native shapes for charts. Icons are usually acceptable |
| Image with `cornerRadius`, border, filter, or mask | Effect is baked into the picture | Accept it, or apply the effect in PowerPoint |
| Gradient text | First color only | A solid color |
| Curved text | Straight text | Straight text |
| Blend modes | Normal blending | Opacity |
| Rotated table | Unrotated | An unrotated table |
| `group` | Its children, with no PowerPoint group | Accept it |
| Pages of different sizes | All slides use the design size | One size. Lint reports `pptx-page-size` |
| Page `bleed` | Ignored | Use a print PDF |

## Fonts

PowerPoint files do not embed fonts. A viewer without the font sees a substitute,
and text can reflow. Tell the user which fonts the file needs. For a shared deck,
prefer a font that the audience has, or leave room in text boxes.

`textOverflow: "fit"` is computed at export, so the file holds the fitted size.

## Animation

Enter, exit, and loop presets become PowerPoint effects. Slides still advance on
click. `count`, `glow`, and `kenBurns` are skipped, and `blur` becomes a fade.
Text presets by line play on the whole text box.
