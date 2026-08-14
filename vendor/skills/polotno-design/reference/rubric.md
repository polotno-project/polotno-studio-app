# Design rubric

The fixed bar you critique each render against. After you **look** at a preview,
score it against every item below and name which pass and which fail. A render
ships only when all critical items pass. Do not grade on vibes — grade on this list.

The rubric exists because a free-form "does it look good?" plateaus into competent
but soulless output. These items are what separate designed from generated.

## Critical (a fail here blocks shipping)

1. **One focal point.** The eye lands somewhere first — a hero headline, image, or
   number — clearly largest/boldest. If everything is the same weight, there is no
   design. Fix: enlarge the hero, shrink the rest.
2. **Legible text.** Every text passes contrast against what sits behind it; nothing
   is clipped, overlapped, or running off the edge. Text over a photo has a scrim
   (semi-transparent overlay) or sits on a solid area.
3. **Real hierarchy, ≥3 levels.** Headline ≫ subhead > body/detail, with obvious
   size jumps (roughly 1.5–2× between levels), not three near-equal sizes.
4. **Intentional whitespace.** Generous, deliberate margins; the design breathes.
   Cluster related content and leave the remaining space open — clustered content
   plus open space reads as designed; an even wall of elements reads as cheap.
   Empty space is a feature to keep, not a gap to fill.
5. **Alignment.** Elements share edges or a center line on a consistent margin/grid.
   Nothing is a few pixels off. Pick a left margin and a center axis and hold them.

## Important (fix unless a deliberate choice)

6. **Restrained palette.** 2–4 colors total (one dominant, one accent, neutrals).
   More than 4 hues looks accidental. Accent appears on exactly the thing to notice.
7. **≤2 typefaces.** One display/headline + one body is plenty. A third needs a
   reason. Pair a characterful display with a neutral body, not two loud fonts.
8. **Consistent spacing rhythm.** Gaps between related items repeat (e.g. 24/48/96),
   not arbitrary. Related things sit closer than unrelated things (proximity).
9. **Edge-aware composition.** Either a clear uniform margin all around, OR an
   intentional full-bleed element. Avoid the in-between (something almost touching
   an edge by accident).
10. **Color harmony with imagery.** Palette echoes colors in the hero photo; text
    color is pulled from or contrasts cleanly with the image, not fighting it.

## Output discipline

11. **No placeholder residue.** No `${photo:…}` / `${icon:…}` left unresolved, no
    lorem ipsum, no "Option A/B", no wireframe boxes.
12. **Correct canvas for the use.** Size matches the brief (1080×1080 IG post,
    1080×1920 story, 1280×720 thumbnail, A4 at 300dpi for print, …).
