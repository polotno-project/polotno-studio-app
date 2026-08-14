#!/usr/bin/env node
/**
 * validate.js — normalize, repair, and validate a Polotno design.
 *
 * Usage:
 *   node validate.js <design.json> [output.json]
 *
 * Pipeline (in order):
 *   1. normalizeDesign  — fill defaults, strip unknown keys (@polotno/schema)
 *   2. geometric fixers — clamp/remove off-canvas elements, fix text overflow,
 *                         validate fonts + figure subTypes, repair filter shape
 *   3. validateDesign   — canonical-mode schema check (@polotno/schema)
 *
 * Writes the normalized+fixed design back (to output.json, or in place) and
 * prints a JSON report: { valid, errors:[{path,message}], fixes:[...] }.
 * Exit code is non-zero when the design is invalid, so the loop can branch on it.
 *
 * The schema check is the single source of truth for validity. The geometric
 * fixers only catch mechanical mistakes the schema permits but renders badly.
 */
const fs = require('fs');
const path = require('path');

// @polotno/schema is ESM-only — load it with dynamic import() from CommonJS.
async function loadSchema() {
  try {
    return await import('@polotno/schema');
  } catch (e) {
    console.error(
      'Missing dependency @polotno/schema. Run: npm install (in this scripts/ folder)'
    );
    process.exit(2);
  }
}

const fonts = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'google-fonts.json'), 'utf8')
);
const fontSet = new Set(fonts.map((f) => f.toLowerCase()));

const validSubTypes = new Set([
  'rect', 'circle', 'star', 'triangle', 'rightTriangle', 'diamond', 'pentagon',
  'hexagon', 'speechBubble', 'cross', 'arc', 'cloud', 'rightArrow', 'leftArrow',
  'downArrow', 'upArrow', 'heart1', 'shield1', 'flag', 'frame', 'blob1', 'blob2',
  'blob3', 'blob4', 'blob5',
]);

const fixes = [];
const note = (m) => fixes.push(m);

function fixFont(family) {
  if (!family) return 'Open Sans';
  if (fontSet.has(family.toLowerCase())) {
    return fonts.find((f) => f.toLowerCase() === family.toLowerCase()) || family;
  }
  const l = family.toLowerCase();
  let fallback = 'Open Sans';
  if (/(script|cursive|hand)/.test(l)) fallback = 'Dancing Script';
  else if (/(display|bold|black)/.test(l)) fallback = 'Montserrat';
  else if (l.includes('serif')) fallback = 'Playfair Display';
  note(`font "${family}" not in Google Fonts → "${fallback}"`);
  return fallback;
}

function fixFilters(filters) {
  if (!filters || typeof filters !== 'object') return filters;
  for (const name of ['contrast', 'saturation', 'brightness', 'grayscale', 'sepia']) {
    if (filters[name] === undefined) continue;
    if (typeof filters[name] === 'number') {
      note(`filter "${name}" number → {intensity}`);
      filters[name] = { intensity: filters[name] };
    } else if (typeof filters[name] !== 'object' || filters[name].intensity === undefined) {
      note(`removed malformed filter "${name}"`);
      delete filters[name];
    }
  }
  return filters;
}

function fixTextOverflow(el, canvasWidth) {
  if (el.type !== 'text') return;
  // letterSpacing is % of fontSize; >3 or <-1 are almost always px mistakes.
  if (el.letterSpacing !== undefined && (el.letterSpacing > 3 || el.letterSpacing < -1)) {
    note(`reset letterSpacing ${el.letterSpacing} on "${el.id || 'text'}"`);
    el.letterSpacing = 0;
  }
  const fontSize = el.fontSize || 16;
  const text = el.text || '';
  const width = el.width || 200;
  const avgChar = fontSize > 60 ? fontSize * 0.75 : fontSize * 0.6;
  const singleLine = !text.includes('\n') && text.length <= 20;
  let needed = 0;
  if (singleLine) {
    needed = text.length * avgChar;
  } else {
    const longest = text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0);
    needed = longest * avgChar;
  }
  if (needed > width) {
    const room = canvasWidth - (el.x || 0) - 48;
    const recommended = Math.ceil(needed * 1.2);
    if (recommended <= room) {
      el.width = recommended;
      note(`widened "${el.id || 'text'}" to ${recommended} to fit text`);
    } else {
      const newSize = Math.floor(fontSize * (room / recommended) * 0.9);
      if (newSize >= 12) {
        el.fontSize = newSize;
        el.width = room;
        note(`shrank "${el.id || 'text'}" fontSize to ${newSize} to fit text`);
      }
    }
  }
}

function fixBounds(children, cw, ch) {
  if (!Array.isArray(children)) return;
  for (let i = children.length - 1; i >= 0; i--) {
    const el = children[i];
    if (el.type === 'group' && el.children) {
      fixBounds(el.children, cw, ch);
      continue;
    }
    if (el.x === undefined || el.y === undefined || el.width === undefined || el.height === undefined) continue;
    const visX = Math.max(0, Math.min(el.x + el.width, cw) - Math.max(el.x, 0));
    const visY = Math.max(0, Math.min(el.y + el.height, ch) - Math.max(el.y, 0));
    const total = el.width * el.height;
    if (total > 0 && visX * visY < total * 0.5) {
      note(`removed off-canvas element "${el.id || el.type}"`);
      children.splice(i, 1);
      continue;
    }
    if (el.x < 0) { el.width += el.x; el.x = 0; note(`clamped x of "${el.id || el.type}"`); }
    if (el.y < 0) { el.height += el.y; el.y = 0; note(`clamped y of "${el.id || el.type}"`); }
    if (el.x + el.width > cw) el.width = cw - el.x;
    if (el.y + el.height > ch) el.height = ch - el.y;
  }
}

function walkFix(children, cw) {
  if (!Array.isArray(children)) return;
  for (const el of children) {
    if (el.type === 'text' && el.fontFamily) el.fontFamily = fixFont(el.fontFamily);
    if (el.type === 'figure' && el.subType && !validSubTypes.has(el.subType)) {
      note(`figure subType "${el.subType}" → "rect"`);
      el.subType = 'rect';
    }
    if (el.type === 'image' && el.filters) el.filters = fixFilters(el.filters);
    if (el.type === 'text') fixTextOverflow(el, cw);
    if (el.type === 'group' && el.children) walkFix(el.children, cw);
  }
}

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error('Usage: node validate.js <design.json> [output.json]');
    process.exit(2);
  }
  const output = process.argv[3] || input;
  const { normalizeDesign, validateDesign } = await loadSchema();

  let design = JSON.parse(fs.readFileSync(input, 'utf8'));

  // 1. geometric fixers first — they repair common AI mistakes (malformed
  //    filters, bad subTypes, off-canvas, overflow) that normalize would
  //    otherwise THROW on. Run before normalize so it sees clean data.
  const cw = design.width || 1080;
  const ch = design.height || 1080;
  for (const page of design.pages || []) {
    if (!page.children) continue;
    fixBounds(page.children, cw, ch);
    walkFix(page.children, cw);
  }

  // 2. normalize (fill defaults, strip unknown keys)
  try {
    design = normalizeDesign(design);
  } catch (e) {
    console.log(JSON.stringify({ valid: false, errors: [{ path: '', message: `normalize failed: ${e.message}` }], fixes }, null, 2));
    process.exit(1);
  }

  // 3. validate (canonical = reject unknown keys)
  const result = validateDesign(design, { mode: 'canonical' });

  fs.writeFileSync(output, JSON.stringify(design, null, 2));
  console.log(JSON.stringify({ valid: result.valid, errors: result.errors || [], fixes }, null, 2));
  process.exit(result.valid ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
