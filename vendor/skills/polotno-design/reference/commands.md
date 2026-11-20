# The command vocabulary

Every Polotno runtime speaks the same verbs. This file defines each verb
once — what it does, what it takes, what it returns. It never names a
transport: your runtime file (`runtimes/*.md`) maps each verb to its MCP
tool, HTTP endpoint, or script. Never invent a verb. Never guess a transport.

A "design" is one Polotno JSON document (see `design-format.md`). Live
runtimes address it by `designId`. Headless runtimes address it by file path.
Page and element ids come from the design JSON itself.

## Documents

- **`create_design`** — start a new design. Args: `width`, `height`,
  optional `name`, optional full `json` to seed it. Returns the design id.
  In live runtimes the design appears on the human's screen immediately.
- **`list_designs`** — list existing designs (id, name, size, page count).
- **`get_design_json`** — read the full design JSON. Returns `{rev, json}`.
  `rev` is the revision counter. Pass this value back in a patch.
- **`patch_design_json`** — apply an RFC 6902 JSON patch to the design.
  Args: `patch` (array of ops), optional `baseRev`. If the design changed
  since your read, you get a `rev_conflict` error — re-read and re-apply.
  The patched document is schema-validated before it touches the design,
  so a bad patch fails cleanly and changes nothing.
- **`save`** — flush the design to its file on disk.

## Pages

- **`set_page`** — set page properties (background, size, duration).
  Args: page id (or the current page), `props`.
- Runtimes with multi-page editing also offer `add_page`, `remove_page`,
  `move_page` — see your runtime file.

## Elements

- **`add_element`** — add one element (text, image, svg, figure, line,
  video, group) to a page. Returns the new element's `id` — keep it, every
  follow-up call needs it.
- **`update_element`** — change properties of one element by id.
- **`remove_element`** — delete elements by id.
- **`move_element`** — change z-order (`direction` or `toIndex`) or move
  to another page (`toPageId`).

## Sizing

- **`set_design_size`** — resize the canvas. Args: `width`, `height`,
  optional `magicResize: true` to scale and reposition elements
  proportionally. Magic resize can cause text overflow. After a resize, run
  `render` and `lint`. Then fix each overflow with `update_element`.

## Eyes and output

- **`render`** — render a page to pixels. Args: optional page id and
  `pixelRatio`. Render every page and view each result before delivery.
- **`lint`** — run deterministic JSON checks. These include placeholders,
  duplicate ids, bounds, likely text fit, tiny text, covered elements, asset
  sources, font declarations, tables, animations, and print hints. A runtime
  can add more checks. Fix each `error`. Review each `warning`. Visual proof
  handles contrast, crop quality, and unintended overlap.
- **`export`** — write the final file. Args: `format`, optional page ids,
  format options. Every runtime accepts `png` and `jpeg`. Your runtime file
  names the rest, and how to reach PowerPoint, GIF, and MP4. PDF is where
  runtimes differ: some give vector pages, some give raster pages, and some
  give both under two different format names. Read `print-pdf.md` before you
  promise any PDF property. Overpromising print features is a bug.

## Typed verbs vs JSON patch

Use the typed element verbs for targeted changes — up to roughly five
elements. Use `get_design_json` + `patch_design_json` for bulk or
structural edits: recoloring every element, rewriting all text, reordering
pages. One well-formed patch beats twenty single-property calls.
