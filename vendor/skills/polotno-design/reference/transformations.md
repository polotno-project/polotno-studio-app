# Transformation contracts

A transformation starts from an existing design. Before editing, declare what
can change and what must remain stable.

## Contracts

| Operation | Allowed changes | Protected properties |
| --- | --- | --- |
| Content update | Requested strings and assigned assets | Canvas, visual tokens, unrelated elements, reading order |
| Resize | Canvas, geometry, text fit, crop | Copy, content order, visual tokens, asset identity |
| Localization | Translated strings, script fonts, required text fit, language direction | Meaning, brand assets, visual roles, layout intent |
| Brand application | Colors, fonts, logos, and named brand treatments | Copy, message hierarchy, content assets, output purpose |
| Bulk variant | Variable values and dependent text fit or crop | Page structure, elements without variables, visual tokens, variable names |

Add user-requested exceptions to the contract before editing. Do not expand the
allowed set because a repair is difficult.

## Procedure

1. Save the source JSON and make a source proof.
2. Select the applicable contract.
3. Record any explicit exception from the user.
4. Derive every result from the source, not from another result.
5. Preserve stable element identifiers and variable names where possible.
6. Run schema validation and preflight on every result.
7. View the source and result at the same display scale.
8. Compare each protected property and record deliberate deviations.

## Operation notes

### Content update

Change only the named content. If new text does not fit, adjust its own box or
type size before you move unrelated elements.

### Resize

Recompose for the new aspect ratio. Do not stretch the full design. Preserve
image subjects during crop changes. Keep the original message order.

### Localization

Preserve meaning and brand terms. Use a font with the required glyphs. Adapt
text fit and reading direction without copying raw geometry blindly. Read the
translated text section of `data-content.md`.

### Brand application

Map each visual role to a supplied brand value. Do not invent a logo, font,
color, or brand rule. Preserve the content hierarchy unless the brand guide
requires a documented change.

### Bulk variant

Start from a design that passed the completion contract.

1. Mark each part that changes with a template variable: see
   `templates-brand.md`. Set `required` on each variable that every row must
   supply.
2. Map every input field to a variable or exclude it explicitly. A dotted name
   reads nested data: `{{user.city}}` reads `row.user.city`.
3. Fill each variant from the same source, with strict checks:
   - **Your own code:** `resolveVariables(template, row, { strict: true })` from
     `@polotno/schema/variables`, once per row. It returns `{ design, issues }`:
     render `design`, and report the `unknown-key` warnings in `issues`, since a
     misspelled column fills nothing. A missing required value or a wrong type
     throws `VARIABLES_INVALID`, with every issue in `details.issues`. Record
     the row and continue.
   - **HTTP:** one Cloud Render job per row, with `"variables": row` and
     `"strict": true`. See `runtimes/backend.md`.
   - **The scripts:** one plan page per row in `scripts/from-template.js`, then
     render each page with `render.js`. A missing or wrong value stops the build
     and names the page.
4. Run schema validation and preflight on every variant. `lint` reports each
   token that would print as written (`variable-unfilled`).
5. View the first row, the longest-text row, and the row with most asset changes.
6. Report failures by a stable row key.

Variable text needs `textOverflow: "fit"`: see `data-content.md`. A value prints
as given, so format numbers, prices, and dates in the row.

### An old source file

A source below the current `schemaVersion` needs `validate.js <file> --normalize
<out.json>` before you edit it. Keep the result. Changing only the number leaves
old values in place.
