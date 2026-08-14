# Design rubric

The fixed bar you critique each render against. After you **look** at a
preview, score every axis below from 0–10 and write a scorecard. Do not
grade on vibes — grade on this list. The rubric exists because a free-form
"does it look good?" plateaus into competent but soulless output.

**The gate: every applicable axis scores 8 or more. No averaging** — a
single 7 fails the design, however strong the rest is. An axis that does
not apply (e.g. Imagery on a vector-only design) passes automatically.
Scoring honestly is the hard part: the common failure is giving your own
work an 8 out of charity. **If you hesitated between two scores, take the
lower one.**

Example sizes below assume a 1080×1080 canvas. For other canvases scale
everything proportionally — A4 at 300dpi (2480×3508) is ≈3.2× larger.

## The axes

1. **Focus** — the eye lands somewhere first: one hero headline, image, or
   number, clearly largest/boldest. If everything is the same weight there
   is no design. Fix: enlarge the hero, shrink the rest.
2. **Hierarchy** — ≥3 obvious levels (headline ≫ subhead > body), with
   real size jumps (roughly 1.5–2× between levels), not three near-equal
   sizes.
3. **Type & legibility** — ≤2 typefaces (characterful display + neutral
   body); every text passes contrast against what actually sits behind it;
   nothing clipped, overlapped, or running off the edge; text over a photo
   has a scrim or sits on a solid area.
4. **Color** — 2–4 colors total: one dominant, one accent, neutrals. The
   accent appears on exactly the thing to notice. More than 4 hues looks
   accidental.
5. **Composition & space** — generous, deliberate margins held
   consistently; elements share edges or a center line (nothing a few
   pixels off); gaps repeat a rhythm (e.g. 24/48/96); related things sit
   closer than unrelated things; either a clean uniform margin or an
   intentional full-bleed — never almost-touching an edge by accident.
   Empty space is a feature to keep, not a gap to fill.
6. **Imagery** — palette echoes the hero photo's colors; text pulls from
   or contrasts cleanly with the image, not fighting it. (N/A when there
   are no photos.)

## The scorecard

After each look, write:

| Axis | Score | Violation | Fix |
| ---- | ----- | --------- | --- |

…one row per axis, with the concrete violation and the concrete fix
("headline 64px vs body 48px — raise headline to 96px"), then the verdict:
**PASS** or **FAIL — fixing**, remediating the worst axis first.

Under the table, one closing line that restates the brief and names any
direction you chose yourself ("brief asked for a spring sale post; I chose
the pastel palette and Poppins — say the word to change either"). The axes
score execution only — this line is the only thing that catches a design
built beautifully in a direction nobody asked for.

## Before shipping: read the JSON once

Some defects render fine today and break tomorrow. On the final pass check
the design JSON itself: no placeholder residue (`${photo:…}`, lorem ipsum,
"Option A/B"); canvas size matches the brief's use (1080×1080 IG post,
1080×1920 story, A4@300dpi = 2480×3508 for print); related elements
grouped; text blocks sized and aligned so a longer string won't silently
break the layout. `lint` checks the mechanical ones — run it and fix every
error.
