---
name: polotno-design
description: >-
  Generate, render, and bulk-produce Polotno designs from a brief. Use when the
  user wants to create a design, poster, flyer, social post, ad, invitation, menu,
  or marketing image from a description; render Polotno JSON to PNG/PDF; or
  bulk-generate design variants from data (a CSV or list). Works two ways: live
  through the Polotno desktop app's MCP tools when connected, or headless from
  the terminal. For building an editor UI, use the polotno-sdk skill instead.
---

# Polotno design generation

Produce shippable Polotno designs from a text brief. The output is a
Polotno JSON design plus a rendered PNG/PDF.

**Which path?** If the Polotno app's MCP tools are available (`create_design`,
`add_element`, `render_page`, …), work live in the app the human is watching:
read `reference/mcp-tools.md` and follow it — the design rules and rubric below
still apply, the scripts do not. Otherwise continue here with the headless
workflow.

The core idea is a closed loop: start from an **archetype** (a composition skeleton,
never a blank canvas), render it, **look** at the render with your own eyes, and
critique it against a fixed **rubric** until it passes. Looking is the whole point —
generating-without-seeing produces competent-but-soulless output. **You are not done
until you have looked at a render and it passes the rubric.**

## Setup (once per project)

Helper scripts live in `scripts/`. Install their deps:

```bash
cd scripts && npm install && cd ..
```

Rendering and asset search need a Polotno key. The scripts fall back to a public
demo key (rate-limited, fine for iterating). For production set your own:

```bash
export POLOTNO_API_KEY=...   # https://polotno.com/cabinet
```

If you **cannot** run a terminal or **cannot** view images, you can't run the loop.
Do steps 1–4, render once, and tell the user plainly that the design was not
visually verified — never claim it looks good when you never saw it.

## Workflow A — generate from a brief

Work on one file, `design.json`. Default mode is **standard** (iterate to a passing
rubric, cap 3 looks). For **quick**, do one look and one fix. For **best**, generate
3 candidates through step 5, then iterate only the strongest.

1. **Frame the brief and choose tokens.** Read `reference/archetypes.md`. Pick the
   canvas size, one archetype, and explicit design tokens (palette of 2–4 colors,
   type scale, ≤2 fonts, margin + spacing unit). Write the tokens down.
   *Done when:* archetype named and every token has a concrete value.

2. **Author minimal Polotno JSON** into `design.json`, filling the archetype's zones
   with the brief's content and your tokens. Reference images/icons you don't have
   as `${photo:3-5 words}` / `${icon:1-2 nouns}`. See `reference/design-format.md`.
   *Done when:* `design.json` covers the archetype's zones with real content.

3. **Validate and repair:** `node scripts/validate.js design.json`. Read the report;
   if `valid` is false, fix each `errors[]` entry and re-run.
   *Done when:* the report shows `valid: true`.

4. **Resolve assets.** For each placeholder, search and *look* before choosing:
   `node scripts/resolve-assets.js search photo "latte art coffee cup"`. Pick the
   best-fitting `url` from the candidates and paste it into the element's `src`.
   (For bulk or unattended runs, `resolve-assets.js resolve design.json` auto-picks
   the first hit.) Re-run step 3 after editing.
   *Done when:* no `${photo:…}` / `${icon:…}` placeholders remain.

5. **Render a preview and LOOK:** `node scripts/render.js design.json preview.png`,
   then open/Read `preview.png`. Actually view it.
   *Done when:* you have viewed the rendered pixels (not just the JSON).

6. **Critique against the rubric and fix.** Score `preview.png` against every item
   in `reference/rubric.md`; list which pass and which fail. Edit `design.json` to
   fix the fails, then return to step 3.
   *Done when:* every **critical** rubric item passes, or you have completed 3 looks
   — whichever comes first. State the final pass/fail list.

7. **Export final output:** `node scripts/render.js design.json out.png --full`
   (or `out.pdf --pdf`). Report the design.json and the rendered file.

## Workflow B — bulk variants from data

Use a design that already passed Workflow A as the template.

1. **Mark slots.** In the template, tag each element that varies across variants with
   `custom: { slot: "<name>" }` (e.g. `headline`, `hero`, `price`). Fixed brand
   elements get no slot.
   *Done when:* every element that varies has a slot name; fixed elements have none.
2. **Map data to slots.** Take the user's CSV/list; each row is one variant. Confirm
   each column maps to a slot name.
   *Done when:* every column is mapped to a slot or explicitly set aside.
3. **Generate + render each variant.** For every row, copy the template, set each
   slotted element's content (`text`, or `src` via `resolve-assets.js`) from the row,
   run `validate.js`, then `render.js … --full` to a per-row output file.
   *Done when:* every row has a rendered output file.
4. **Spot-check by looking.** View the first variant and one random later variant
   against the rubric before declaring the batch done. Report any rows that dropped
   elements during validation/asset resolution — never report a clean batch silently.

## Scope

This skill generates and renders designs headlessly. It does **not** build editor
UIs, wire up React/MobX, or customize side panels — that is the `polotno-sdk` skill.
