# Visual proof checks

Use these checks after you view a current render. The render supplies visual
evidence. The JSON and preflight report supply structural evidence.

Do not rate the design with numbers. Mark each applicable check as `pass` or `block`.
If the design does not contain the item, use `not applicable`. Apply the checks
to every page.

For a new design, apply the visual quality bar from `archetypes.md`. A violation
of this bar is a `block`. A personal preference that does not violate the bar
is a note.

## Proof report

If a repair cycle needs a written report, use this form:

| Check | Result | Evidence | Repair |
| --- | --- | --- | --- |

Give evidence from the current render or JSON. Name a specific repair for each
`block` result. A preference without a delivery risk is a note, not a blocker.

## Checks

### Content

All required copy, prices, dates, names, and calls to action must be present
and correct. No placeholder, option text, or `{{name}}` token can remain.

### Visual intent

The design must show one deliberate visual decision that connects to the
message, audience, or media. Generic decoration alone does not pass this check.

### Reading path

One point of attention must clearly dominate. It must match the message. The
remaining content must follow a clear order. Related items must read as one
unit. Different information levels must have visibly different emphasis.

### Typography

All text must be legible at the intended output size. Text must not clip,
overflow, collide, or use a missing glyph. A render that reports overflow fails
this check. Type roles must be visibly different
and consistent. Extra font families require a reason from the brief or brand.

### Frame and spacing

Alignment and spacing must form a deliberate system. Edge contact and overlap
must be intentional. Repeated gaps must use a clear rhythm. Empty space must
support focus or grouping. Required content must stay inside its safe area.

### Color

Text must have sufficient contrast against the pixels behind it. Color roles
must remain consistent. Each authored color must have a role. Emphasis color
must identify the intended content.

### Media

Each image or icon must support the brief. Crops must keep the subject. Media
must not stretch, blur, or show an unresolved source.

### Editability

Important text must remain editable. Logical clusters must stay grouped.
Element identifiers must be unique. A template keeps its tokens and bindings on
the parts that change.

### Output

The canvas and format must match the delivery contract. Print output must obey
the required bleed, safe area, resolution, and PDF rules.

## Repair order

Use this order:

1. Correct missing or wrong content.
2. Correct clipping, overflow, missing assets, and unreadable text.
3. Correct visual intent, focus, and reading order.
4. Correct alignment, spacing, crop, type roles, and color roles.

For a short task, repair blockers and stop. Do not continue with preference-only
adjustments after the proof passes.

## Transformed designs

For a transformed design, view the source and result at the same display scale.
Use the protected properties in `transformations.md` as additional proof checks.

If a result changes a protected property without an explicit reason, it fails.
