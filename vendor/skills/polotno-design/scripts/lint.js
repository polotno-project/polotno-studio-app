#!/usr/bin/env node
/**
 * lint.js — design checks that read the JSON (no rendering needed).
 * Catches defects a rendered preview can't show, plus mechanical mistakes.
 *
 *   node lint.js <design.json>
 *
 * Prints { errors, warnings }; exit code 1 when there are errors.
 * Rules:
 *   placeholder-residue  ${photo:…}/${icon:…} or lorem ipsum left in
 *   letter-spacing       letterSpacing is an em-multiple; |v| > 2 means px/% units
 *   font-unknown         fontFamily not a known Google font and not in design.fonts
 *   out-of-bounds        element bbox outside the canvas (rotation ignored)
 *   covered-element      element fully hidden behind a later opaque figure/image
 *   tiny-text            fontSize < canvasHeight/90 (canvas-relative, print-safe)
 *   print-bleed          dpi suggests print but pages have no bleed
 *   empty-page           page with no elements
 */
const fs = require('fs');
const path = require('path');

const input = process.argv[2];
if (!input) {
  console.error('Usage: node lint.js <design.json>');
  process.exit(2);
}
const design = JSON.parse(fs.readFileSync(input, 'utf8'));
const knownFonts = new Set(
  JSON.parse(fs.readFileSync(path.join(__dirname, 'google-fonts.json'), 'utf8'))
);

const errors = [];
const warnings = [];
const report = (list, rule, pageId, elementId, message) =>
  list.push({ rule, pageId, ...(elementId ? { elementId } : {}), message });

const W = design.width || 1080;
const H = design.height || 1080;
const designFonts = new Set((design.fonts || []).map((f) => f.fontFamily || f.name));

const PLACEHOLDER = /\$\{(photo|icon):/;

function* elements(children, parentVisible = true) {
  for (const el of children || []) {
    yield el;
    if (el.type === 'group') yield* elements(el.children, parentVisible);
  }
}

for (const page of design.pages || []) {
  const pageId = page.id;
  const kids = [...elements(page.children)];
  if (kids.length === 0) {
    report(warnings, 'empty-page', pageId, null, 'page has no elements');
    continue;
  }

  const flat = page.children || []; // z-order only meaningful at top level
  flat.forEach((el, index) => {
    // placeholder residue
    if (typeof el.src === 'string' && PLACEHOLDER.test(el.src)) {
      report(errors, 'placeholder-residue', pageId, el.id, `unresolved placeholder in src: ${el.src}`);
    }
    if (el.type === 'text' && /lorem ipsum/i.test(el.text || '')) {
      report(errors, 'placeholder-residue', pageId, el.id, 'lorem ipsum left in text');
    }

    if (el.type === 'text') {
      // letterSpacing units
      const ls = el.letterSpacing;
      if (typeof ls === 'number' && Math.abs(ls) > 2) {
        report(
          errors,
          'letter-spacing',
          pageId,
          el.id,
          `letterSpacing ${ls} — it is a multiple of fontSize (0.3–0.5 is wide); this looks like px or %`
        );
      }
      // font reality
      const family = el.fontFamily;
      if (family && !knownFonts.has(family) && !designFonts.has(family)) {
        report(
          warnings,
          'font-unknown',
          pageId,
          el.id,
          `fontFamily "${family}" is not a known Google font and not declared in design.fonts — it will silently fall back`
        );
      }
      // tiny text, canvas-relative (print canvases are big; absolute px lies)
      const minSize = H / 90;
      if (typeof el.fontSize === 'number' && el.fontSize < minSize) {
        report(
          warnings,
          'tiny-text',
          pageId,
          el.id,
          `fontSize ${el.fontSize} < ${Math.round(minSize)} (1/90 of canvas height) — likely illegible at output size`
        );
      }
    }

    // out of bounds (rotation ignored — treat as a hint, not proof)
    if (typeof el.x === 'number' && typeof el.width === 'number' && !el.rotation) {
      const fullyOut = el.x >= W || el.y >= H || el.x + el.width <= 0 || el.y + (el.height || 0) <= 0;
      if (fullyOut) {
        report(errors, 'out-of-bounds', pageId, el.id, 'element is entirely outside the canvas');
      }
    }

    // fully covered by a later opaque figure/image
    const covered = flat.slice(index + 1).some((above) => {
      if (!['figure', 'image'].includes(above.type)) return false;
      if ((above.opacity ?? 1) < 0.98 || above.rotation) return false;
      if (above.type === 'figure' && above.subType && above.subType !== 'rect') return false;
      return (
        above.x <= el.x &&
        above.y <= el.y &&
        above.x + above.width >= el.x + (el.width || 0) &&
        above.y + above.height >= el.y + (el.height || 0)
      );
    });
    if (covered) {
      report(
        warnings,
        'covered-element',
        pageId,
        el.id,
        'element is completely hidden behind a later opaque element — remove it or reorder'
      );
    }
  });
}

// print intent without bleed
if ((design.dpi || 72) >= 150) {
  const noBleed = (design.pages || []).every((p) => !p.bleed);
  if (noBleed) {
    report(
      warnings,
      'print-bleed',
      null,
      null,
      `dpi ${design.dpi} suggests print, but no page sets bleed — see reference/print-pdf.md`
    );
  }
}

console.log(JSON.stringify({ errors, warnings }, null, 2));
process.exit(errors.length ? 1 : 0);
