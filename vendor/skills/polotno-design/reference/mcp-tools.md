# Live editing via the Polotno app (MCP)

You are connected to the Polotno desktop app. You edit the same live designs
the human sees: every edit appears on their canvas immediately and shares
their undo stack. Do not use the headless scripts (`render.js`, `validate.js`)
— the app replaces them.

The design language is unchanged: same JSON model, same archetypes, same
rubric. `reference/design-format.md`, `reference/archetypes.md`, and
`reference/rubric.md` apply to both paths.

## The loop

Same closed loop as the headless path, with tools instead of scripts:

1. `create_design` (or `list_designs` + `open_design` for an existing one).
   New designs open as a tab the human sees immediately.
2. Edit. `add_element` returns the `elementId` you need for every follow-up
   `update_element` / `move_element` call — keep it.
3. LOOK: `render_page` returns the rendered pixels. View them.
4. `lint_design` reports text overflow, out-of-bounds, low contrast, tiny
   text, overlapping text, broken assets, missing fonts. Fix every `error`,
   weigh each `warning`, then re-render.
5. Critique the render against `reference/rubric.md` and iterate.
6. `export_design` writes png/jpeg/pdf files; `save_design` binds a design to
   a `.polotno` file.

You are not done until a render passed the rubric and lint reports no errors.

## Typed tools vs JSON patch

- Typed tools (`add_element`, `update_element`, `set_page`, `set_design_size`,
  …) for targeted changes — up to roughly five elements.
- `get_design_json` + `patch_design_json` (RFC 6902) for bulk or structural
  edits: recoloring every element, rewriting all text, reordering pages.
  Pass the `rev` you read as `baseRev`; on a `rev_conflict` error re-read and
  re-apply. The patched document is schema-validated before it touches the
  design, so a bad patch fails cleanly.

## Recipes

**Create a set** (e.g. "5 Instagram posts"): one `create_design` per post so
each gets its own tab. Build the first to a passing render, then reuse its
palette and layout for the rest via `get_design_json` on the first +
`create_design` with an adapted `json`. Render and lint each one.

**Rebrand**: `get_design_json`, map old colors/fonts to the new brand, apply
as one `patch_design_json`, then render to check contrast survived.

**Resize**: `set_design_size` with `magicResize: true`, then `render_page` +
`lint_design` — magic resize scales elements but text can overflow at new
proportions; fix overflows with `update_element`.

**Localize**: `get_design_json`, collect text elements, `update_element` each
with the translated text, then `lint_design` — translations run longer than
the source and overflow; shorten or shrink until lint is clean.

## Concurrency with the human

The human can edit any design while you work. Your edits and theirs land in
the same store, one at a time — there are no merge conflicts. If a render
looks different from what you expected, the human probably changed something:
re-read with `get_design_json` before editing further.
