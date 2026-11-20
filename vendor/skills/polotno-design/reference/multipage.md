# Multi-page designs

A deck, report, proposal, catalog, or carousel is one Polotno JSON with several
pages. It stays one editable document.

## Plan the document first

Finish this plan before you author a page.

1. **Storyline.** Write one line per page. Each line states what that page
   proves, as a sentence: "Two suppliers hold 39% of spend", not "Supplier
   analysis". Read the lines in order. They must make the argument alone.
2. **Page types.** Give each line a type from the table below.
3. **Tokens.** Define one set from `archetypes.md` for the whole document. A page
   changes a token only for a reason from the brief.
4. **Path.** Choose a template or free-form layout. See below.

Build one page of each type and proof them. Then build the rest, so a layout
error is corrected once.

## Page types

| Type | Purpose | Rule |
|---|---|---|
| Cover | Title, audience, date | One statement, no data |
| Section | Marks a change of topic | Few words. Use a distinct surface color |
| Statement | One finding or quote | Type field recipe |
| Content | Claim with support | Title states the claim. Text and one visual |
| Chart | Claim with numbers | See `data-content.md` |
| Table | Exact values | See `data-content.md` |
| Comparison | Two or three options | Split field recipe, same rows on each side |
| Timeline | Steps or a roadmap | Ordered rows recipe, one axis |
| Closing | Decision or next step | Ask for one action |

## Document kinds

| Kind | Default size | Page rule |
|---|---|---|
| Deck | 1920×1080 | One idea per page. Body text 28px or more. The title is a sentence |
| Report | A4 or Letter | Reading density is fine. Body text 11pt or more at print size. Number the pages |
| Proposal | A4 or 1920×1080 | Scope, price, and terms get their own pages |
| Catalog | A4 or Letter | One item grid repeated. Fill it from data with `from-template.js` |
| Carousel | 1080×1350 | Each page must make sense alone. Page 1 is the hook. Every page has the same size |

## Repeated elements

Polotno has no master page, so each page holds its own copy of a logo, footer,
or title. Add `custom: { "repeat": "<key>" }` to each copy. `lint` reports each
copy that differs from the first in position, size, or style. Text can differ,
so use one key for all page titles and one for all page numbers.

## Template or free-form

| Use a template when | Use free-form when |
|---|---|
| The customer supplied one | There is no template and no brand system |
| The output repeats, per customer or per data row | The piece is one of a kind |
| An unattended run must stay on brand | The content does not fit any layout page |

Read `templates-brand.md` for the template path. A free-form page inside a
template deck keeps the template's tokens and repeated elements.

## Proof every page

1. Render all pages. Every page gets a file.
2. View each page and apply `proof-checks.md`.
3. Render `--sheet` and view all pages together. Check the rhythm, repeated
   elements, and page types.
4. Read the page titles in order. They must still make the argument.

The proof is complete when every page id has a result.

## Output

Use `--vector` for PDF, so that text stays selectable. For PowerPoint, read
`pptx.md` before you author, because some choices cannot be changed later.
