# Polotno App

A local-first desktop design editor. The human edits designs in a window; AI
agents edit the same live designs through a built-in MCP server. This glossary
fixes the words both halves use.

## Language

**Design**:
A single visual document — one or more pages of elements. The unit a person
opens, edits, saves, and exports.
_Avoid_: project, artboard, canvas, doc

**Design JSON**:
The plain-object form of a design, exactly what `store.toJSON()` produces. It
is also the on-disk file format.
_Avoid_: snapshot, payload, design data

**Page**:
One surface within a design, holding an ordered stack of elements. Later
elements in the stack render on top.
_Avoid_: slide, frame, board

**Element**:
One item placed on a page — text, image, svg, figure, line, video, or group.
_Avoid_: object, node, shape, layer

**Tab**:
One design open in the editor window, holding its own live store and undo
history. Tabs stay alive in the background; only the active one is on screen.
_Avoid_: window, pane, editor instance

**Library**:
The visible folder of every design the person owns (`Documents/Polotno`).
Designs are created into it, listed from it, and deleted out of it — a design
is never hidden from the file system.
_Avoid_: workspace, vault, gallery, drafts

**Lint**:
The design quality check: reading a design and reporting what is wrong with it
visually — overflowing text, weak contrast, unreadable sizes, broken assets.
Always means design lint here; code linting is only ever "eslint".
_Avoid_: validate, check, audit

**Finding**:
One problem lint reports about one design, carrying a severity of `error` or
`warning`. Findings describe a design; they never block an edit.
_Avoid_: issue, violation, error, warning, diagnostic

**Validate**:
Checking a design JSON against the published `@polotno/schema` — a question of
structural correctness only. Separate from lint, which asks whether a
structurally valid design actually looks right.
_Avoid_: verify, check
