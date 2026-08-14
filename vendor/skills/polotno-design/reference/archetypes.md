# Layout archetypes & design tokens

Generation starts from an **archetype** — a composition skeleton a human designer
would reach for — not a blank canvas. Pick one that fits the brief, then fill its
zones. The archetype carries the taste; you supply the content. This is what makes
from-scratch output look designed instead of arranged.

Zones are described as fractions of the canvas. Coordinates below assume a
1080×1080 canvas — scale to the real size.

## Choosing an archetype

| Brief smells like… | Archetype |
|---|---|
| Quote, announcement, bold statement, sale | **Centered hero** |
| Product, real estate, food, travel, portrait | **Image bleed + caption** |
| Event, profile, before/after, two ideas | **Split** |
| Menu, lineup, schedule, price list, steps | **Stacked list** |
| Logo, badge, certificate, monogram, emblem | **Framed emblem** |

When a brief has no strong photo need (invitation, menu, certificate, quote,
minimal/abstract), prefer **vector-only**: typography + figures + gradients + icons.
It is the most reliable lane and needs no photo search.

## The archetypes

### Centered hero
A single dominant headline on a solid/gradient field; everything else defers.
- Background: full-canvas solid or gradient figure.
- Hero headline: centered, ~y 0.36–0.58, width ~0.8, the largest element by far.
- Eyebrow (small label) above the hero; one supporting line + accent rule below.
- Wide outer margins (≥0.08). Let the field breathe — do not fill the corners.

### Image bleed + caption
One hero photo dominates; text sits in a calm zone over or beside it.
- Hero image: full-bleed, or covering ~0.62 of one side/top.
- Text zone over the image gets a scrim (figure, fill #000 opacity 0.25–0.45) OR
  sits on an adjacent solid band. Never raw text on a busy photo.
- Headline + 1–2 details stacked in the calm zone, left-aligned on one margin.

### Split
Canvas divided ~50/50 (vertical or horizontal) into two fields.
- One field: image or bold color block. Other field: text on a clean background.
- Hold one shared margin across the seam. Headline in the text field, detail below.
- Optional accent shape straddling the seam to tie the halves together.

### Stacked list
A title block over evenly-rhythmed rows (menu, lineup, schedule).
- Title zone: top ~0.22, with the strongest type.
- Rows: 5–8 items in the remaining space, consistent row height and baseline grid,
  name left / price-or-time right on a shared right margin.
- A thin divider or alternating row tint for rhythm. Keep generous side margins.

### Framed emblem
Symmetric, centered, contained — for badges, certificates, monograms.
- Decorative frame/border with even inset (~0.1 all sides).
- Centered stack: top flourish, central name/monogram (hero), date/tagline below.
- Strict vertical symmetry. Negative space inside the frame is the point.

## Design tokens (decide once, before writing JSON)

- **Palette:** pick 2–4 colors — one dominant, one accent, plus neutrals. State the
  hexes. Accent goes only on the one thing to notice. Echo the hero photo's colors
  if there is one.
- **Type scale:** pick a base size, build levels by ~1.5–2×
  (e.g. 24 / 40 / 72). Headline at the top level, body at the base, nothing in
  between competing.
- **Type pairing:** one display/headline font + one body font (≤2 total). Pair a
  characterful display with a neutral body. See `design-format.md` for known fonts.
- **Margin & rhythm:** one outer margin (≥8% of the short edge) and one spacing unit
  (e.g. 24) that multiples (24/48/96) derive from. Reuse them everywhere.

Write these tokens down explicitly, then honor them in every element you author —
that consistency is half of what reads as "designed."
