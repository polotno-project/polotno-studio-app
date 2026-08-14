---
name: polotno-design
description: >-
  Generate, render, and bulk-produce Polotno designs from a brief. Use when
  the user wants to create a design, poster, flyer, social post, ad,
  invitation, menu, or marketing image; render Polotno JSON to PNG/PDF
  (including print-ready PDF); import a PDF/PSD/SVG into an editable design;
  or bulk-generate variants from data. Works against whichever Polotno
  runtime is available — the desktop app (live, human co-edits), a
  skill-served local editor, or fully headless — picked by the runtime
  ladder inside. For building an editor UI, use the polotno-sdk skill.
---

# Polotno design generation

Produce shippable Polotno designs from a text brief: a Polotno JSON design
plus rendered output.

Talk to the user about designs, not about this skill: what you made, what
you changed, what you need from them. The ladder, archetypes, rubric, and
validation are your internal process — mention them only if asked. After
installing, one line ("Ready — what should I design?") beats a summary of
this document. The core is a closed loop: start from an
**archetype** (a composition skeleton, never a blank canvas), render it,
**look** at the render with your own eyes, and critique it against a fixed
**rubric** until it passes. Looking is the whole point — generating without
seeing produces competent-but-soulless output. **You are not done until you
have looked at a render and it passes the rubric.**

## Step 0 — pick your runtime (first match wins)

Probe in order; read ONLY the matching file in `reference/runtimes/`. The
tier is dynamic — probe at the start of a task, re-probe only when a call
fails or the user asks to switch. An explicit user preference beats the
ladder ("do it headless" wins even with the app running).

1. **Polotno desktop app, MCP** — tools named `create_design`,
   `render_page`, `lint_design` are in your tool list →
   `runtimes/local-app.md`. The human co-edits live.
2. **Polotno desktop app, HTTP** — you have a terminal and the app's
   discovery file exists (paths in `local-app.md`) and its health URL
   answers → same file, HTTP transport. Dead health check = the app is
   closed; fall through (and mention the user can open the app).
3. **Local editor server** — `scripts/serve.js` exists, `node` works, and
   a human is present to open a browser → start it, then
   `runtimes/local-server.md`.
4. **Studio bridge** — reserved, not yet available
   (`runtimes/studio-bridge.md`). Fall through.
5. **Headless** — terminal + node (or the Cloud Render API when Chromium
   can't run) → `runtimes/headless.md`. Bulk/unattended jobs may pick this
   tier deliberately even when a higher one is available.
6. **No terminal at all** — you can't run the loop. Author the JSON
   (steps 1–3 below), give it to the user with polotno.com/studio import
   instructions, and say plainly it was not visually verified.

## One vocabulary

Every runtime speaks the same verbs — `create_design`, `list_designs`,
`get_design_json`, `patch_design_json`, `add_element`, `update_element`,
`remove_element`, `move_element`, `set_page`, `set_design_size`, `render`,
`export`, `lint`, `save` — defined once in `reference/commands.md`. Your
runtime file only maps verbs to a transport. Never invent a verb; never
guess a transport.

## Design core (all runtimes)

`reference/archetypes.md` (skeletons + tokens), `reference/design-format.md`
(JSON cheat sheet), `reference/rubric.md` (the bar every render must pass).
Before promising print output or file import, read `reference/print-pdf.md`
/ `reference/import.md` — they contain hard capability limits.

## Workflow A — generate from a brief

Default mode is **standard** (iterate to a passing rubric, cap 3 looks).
For **quick**, do one look and one fix. For **best**, generate 3 candidates
through step 5, then iterate only the strongest.

1. **Frame the brief.** The design-defining inputs are: purpose/topic,
   format/size, style direction, brand constraints (colors/fonts/logo), and
   the actual text content. If **two or more** are neither stated nor
   safely inferable, ask ONE round of questions — concrete options plus an
   explicit "you decide" — before authoring. Otherwise build now and report
   afterward which ones you chose yourself. Never a second round;
   bulk/unattended runs never ask. Then read `reference/archetypes.md`,
   pick the canvas size, one archetype, and explicit design tokens
   (palette of 2–4 colors, type scale, ≤2 fonts, margin + spacing unit).
   *Done when:* archetype named and every token has a concrete value.
2. **Author minimal Polotno JSON**, filling the archetype's zones with the
   brief's content and your tokens. Reference images/icons you don't have
   as `${photo:3-5 words}` / `${icon:1-2 nouns}`. See
   `reference/design-format.md`.
   *Done when:* every archetype zone has real content.
3. **Validate and lint** (your runtime's `lint` verb). Fix each reported
   error and re-run.
   *Done when:* the report is clean.
4. **Resolve assets.** For each placeholder, search and *look* before
   choosing (asset search per your runtime file; auto-pick only for
   unattended runs).
   *Done when:* no `${photo:…}` / `${icon:…}` placeholders remain.
5. **Render and LOOK** (`render`). Actually view the pixels.
   *Done when:* you have viewed the render, not just the JSON.
6. **Critique against the rubric and fix.** Score the render on every axis
   in `reference/rubric.md` and write its scorecard; fix the worst axis
   first and return to step 3.
   *Done when:* every applicable axis scores 8+, or you have completed
   3 looks — whichever comes first. State the final scorecard including
   its closing brief line.
7. **Export** (`export`) the final output and report the design + files.
   For PDF/print, follow `reference/print-pdf.md`.

## Workflow B — bulk variants from data

Use a design that already passed Workflow A as the template.

1. **Mark slots.** Tag each element that varies with
   `custom: { slot: "<name>" }` (e.g. `headline`, `hero`, `price`). Fixed
   brand elements get no slot.
2. **Map data to slots.** Each CSV/list row is one variant; confirm every
   column maps to a slot or is set aside.
3. **Generate each variant** — one design per row with slotted content
   filled from the row (your runtime file's Bulk section says how), then
   `lint` and `render` each.
4. **Spot-check by looking.** View the first variant and one random later
   one against the rubric. Report any rows that dropped elements — never
   report a clean batch silently.

## Scope

This skill produces designs. It does **not** build editor UIs, wire up
React/MobX, or answer SDK API questions — that is the `polotno-sdk` skill.
