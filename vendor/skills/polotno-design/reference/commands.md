# The command vocabulary

Every Polotno runtime speaks the same verbs. This file defines each verb
once — what it does, what it takes, what it returns. It never names a
transport: your runtime file (`runtimes/*.md`) maps each verb to its MCP
tool, HTTP endpoint, or script. Never invent a verb; never guess a
transport.

A "design" is one Polotno JSON document (see `design-format.md`). Live
runtimes address it by `designId`; headless runtimes address it by file
path. "Page" and "element" ids come from the design JSON itself.

## Documents

- **`create_design`** — start a new design. Args: `width`, `height`,
  optional `name`, optional full `json` to seed it. Returns the design id.
  In live runtimes the design appears on the human's screen immediately.
- **`list_designs`** — list existing designs (id, name, size, page count).
- **`get_design_json`** — read the full design JSON. Returns `{rev, json}`.
  `rev` is the revision counter you pass back when patching.
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
  proportionally. Magic resize is deterministic and fast, but text can
  overflow at new proportions — always `render` + `lint` after, and fix
  overflows with `update_element`.

## Eyes and output

- **`render`** — render a page to pixels and LOOK at them. Args: optional
  page id, `pixelRatio`. This is the loop's core step: you are not done
  until you have seen a render.
- **`lint`** — machine checks on the design: text overflow, out-of-bounds,
  low contrast, tiny text, overlapping text, broken assets, missing fonts.
  Fix every `error`, weigh each `warning`, then re-render.
- **`export`** — write the final file. Args: `format` (`png`, `jpeg`,
  `pdf`), optional page ids, format options. For print PDF (dpi, bleed,
  crop marks, CMYK, PDF/X) read `print-pdf.md` first — capabilities differ
  by runtime and package, and overpromising print features is a bug.

## Typed verbs vs JSON patch

Use the typed element verbs for targeted changes — up to roughly five
elements. Use `get_design_json` + `patch_design_json` for bulk or
structural edits: recoloring every element, rewriting all text, reordering
pages. One well-formed patch beats twenty single-property calls.
