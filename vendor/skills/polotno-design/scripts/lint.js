#!/usr/bin/env node
/**
 * Run deterministic checks on Polotno JSON. This script does not render or
 * change the design.
 *
 * Usage:
 *   node lint.js <design.json> [--brand <file>] [--target pptx]
 *
 * --brand checks colors and fonts. The file is {"colors":[…],"fonts":[…]} or a
 * template design. A template's custom.brand applies, or else the colors and
 * fonts it uses. Without the flag, lint reads custom.brand from the design.
 * --target pptx names the elements that PowerPoint flattens or changes.
 *
 * Template variables are filled with their stored values first. A {{name}}
 * token that still shows prints as written, so it is an error.
 */
const fs = require('fs');
const path = require('path');

const { ensureDependencies } = require('./dependencies');

const PLACEHOLDER_SOURCE = /\$\{(?:photo|icon):[^}]*\}/i;
const PLACEHOLDER_TEXT = /lorem ipsum|\boption\s+[a-z](?:\s*\/\s*option\s+[a-z])?/i;
const ASSET_TYPES = new Set(['image', 'svg', 'gif', 'video']);
const KNOWN_SOURCE = /^(?:https?:|data:|blob:|file:|workspace:|asset:|\/|\.\.?\/)/i;

// test.js compares these lists with polotno/utils/animations. cameraZoom works
// but has no public docs yet, so the references leave it out.
const TEXT_TRANSITIONS = ['typewriter', 'lineRise', 'wordRise', 'wordFade', 'letterPop', 'wordBlur', 'lineWipe', 'linePeek'];
const TEXT_LOOPS = ['letterWave'];
const TRANSITIONS = ['none', 'fade', 'move', 'zoom', 'pop', 'rise', 'flip', 'growTurn', 'wipe', 'blur', 'count', 'cameraZoom', ...TEXT_TRANSITIONS];
const LOOPS = ['none', 'rotate', 'blink', 'bounce', 'pulse', 'float', 'shake', 'glow', 'kenBurns', ...TEXT_LOOPS];
const ANIMATION_NAMES = { enter: new Set(TRANSITIONS), exit: new Set(TRANSITIONS), loop: new Set(LOOPS) };
const EASINGS = new Set(['linear', 'easeIn', 'easeOut', 'easeInOut', 'backIn', 'backOut', 'backInOut']);
const READING_MS_PER_WORD = 250;
const DEFAULT_PAGE_DURATION = 5000;

// Scripts with no glyphs in a server without system fonts. They draw as empty
// boxes there, while a laptop falls back to an installed font and looks fine.
const NEEDS_SCRIPT_FONT = /[ऀ-෿฀-๿ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/;
const SCRIPT_FONT = /noto|cjk/i;

// The figures that pptx-export writes as native shapes (see its figure.ts).
const PPTX_SHAPES = new Set([
  'rect', 'circle', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'star',
  'cross', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'heart1', 'cloud'
]);
const PPTX_SKIPPED_ANIMATIONS = new Set(['count', 'glow', 'kenBurns', 'cameraZoom']);

function issue(list, rule, pageId, elementId, message) {
  list.push({ rule, pageId, ...(elementId ? { elementId } : {}), message });
}

function plainText(text) {
  return String(text)
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function textLineCount(text, maxChars) {
  let lines = 0;
  for (const paragraph of String(text).split('\n')) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0;
    let paragraphLines = 1;
    for (const word of words) {
      if (word.length > maxChars) {
        if (used > 0) paragraphLines += 1;
        paragraphLines += Math.ceil(word.length / maxChars) - 1;
        used = word.length % maxChars || maxChars;
        continue;
      }

      const next = used === 0 ? word.length : used + 1 + word.length;
      if (used > 0 && next > maxChars) {
        paragraphLines += 1;
        used = word.length;
      } else {
        used = next;
      }
    }
    lines += paragraphLines;
  }
  return lines;
}

function textFitWarning(element) {
  const { text, width, height, fontSize } = element;
  if (!text || ![width, height, fontSize].every((value) => Number.isFinite(value))) {
    return null;
  }
  if (width <= 0 || height <= 0 || fontSize <= 0) return null;

  const spacing = Number.isFinite(element.letterSpacing)
    ? Math.max(0, element.letterSpacing) * fontSize
    : 0;
  const averageGlyphWidth = fontSize * 0.56 + spacing;
  const maxChars = Math.max(1, Math.floor(width / averageGlyphWidth));
  const lines = textLineCount(plainText(text), maxChars);
  const lineHeight = Number.isFinite(element.lineHeight) ? element.lineHeight : 1.2;
  const requiredHeight = lines * fontSize * lineHeight;
  if (requiredHeight <= height * 1.05) return null;

  return `estimated text height ${Math.ceil(requiredHeight)} exceeds box height ${height}`;
}

function hasBox(element) {
  return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(element[key]));
}

function solidOpaqueRect(element) {
  if (element.type !== 'figure') return false;
  if (element.subType && element.subType !== 'rect') return false;
  if ((element.opacity ?? 1) < 0.98 || element.rotation) return false;
  const fill = String(element.fill || '').replace(/\s+/g, '').toLowerCase();
  if (fill === 'transparent') return false;
  const rgba = /^rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)$/.exec(fill);
  return !rgba || Number(rgba[1]) >= 0.98;
}

function contains(outer, inner) {
  if (!hasBox(outer) || !hasBox(inner)) return false;
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  );
}

function forEachNode(children, visit) {
  for (const node of Array.isArray(children) ? children : []) {
    visit(node);
    forEachNode(node.children, visit);
    for (const cell of Array.isArray(node.cells) ? node.cells : []) visit(cell);
  }
}

function normalizeColor(token) {
  const value = token.trim().toLowerCase();
  if (value === 'black') return '#000000';
  if (value === 'white') return '#ffffff';
  if (/^#[0-9a-f]{3,4}$/.test(value)) {
    return `#${[...value.slice(1, 4)].map((digit) => digit + digit).join('')}`;
  }
  if (/^#[0-9a-f]{6,8}$/.test(value)) return value.slice(0, 7);
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(value);
  if (rgb) {
    const channels = rgb.slice(1, 4).map((channel) => Math.round(Number(channel)));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  return value;
}

function colorsIn(value) {
  if (typeof value !== 'string' || /^(?:https?:|data:|blob:|file:)/i.test(value)) return [];
  const tokens = value.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);
  if (tokens) return tokens.map(normalizeColor);
  const word = value.trim().toLowerCase();
  return /^[a-z]+$/.test(word) && word !== 'transparent' ? [normalizeColor(word)] : [];
}

// Only the colors that draw. A design saved by the editor holds a default for
// every color property, such as a stroke with no width.
function nodeColors(node) {
  const colors = [];
  const add = (value) => colors.push(...colorsIn(value));
  add(node.fill);
  add(node.color);
  add(node.cellBackground);
  if (node.strokeWidth > 0) add(node.stroke);
  if (node.backgroundEnabled) add(node.backgroundColor);
  if (node.borderSize > 0 || node.borderWidth > 0) add(node.borderColor);
  if (node.shadowEnabled) add(node.shadowColor);
  Object.values(node.colorsReplace || {}).forEach(add);
  Object.values(node.borders || {}).forEach((side) => add(side?.color));
  if (typeof node.text === 'string' && node.text.includes('<')) {
    for (const [, color] of node.text.matchAll(/(?:^|[\s;"'])color:\s*([^;"']+)/gi)) add(color);
  }
  return colors;
}

function nodeFonts(node) {
  const fonts = node.fontFamily ? [node.fontFamily] : [];
  if (typeof node.text === 'string' && node.text.includes('<')) {
    for (const [, family] of node.text.matchAll(/font-family:\s*([^;"']+)/gi)) {
      fonts.push(family.replace(/&quot;/g, '').trim());
    }
  }
  return fonts;
}

// A brand file lists colors and fonts, and a template can carry one in
// custom.brand. Any other template implies them through what it uses.
function brandRules(input) {
  if (!input) return null;
  const source = input.custom?.brand ?? input;
  if (!Array.isArray(source.pages)) {
    return {
      colors: source.colors ? new Set(source.colors.map(normalizeColor)) : null,
      fonts: source.fonts ? new Set(source.fonts.map((font) => font.toLowerCase())) : null
    };
  }
  const colors = new Set();
  const fonts = new Set();
  for (const page of source.pages) {
    colorsIn(page.background).forEach((color) => colors.add(color));
    forEachNode(page.children, (node) => {
      nodeColors(node).forEach((color) => colors.add(color));
      nodeFonts(node).forEach((font) => fonts.add(font.toLowerCase()));
    });
  }
  return { colors, fonts };
}

function hasPixelEffects(element) {
  return (
    (element.blurEnabled && (element.blurRadius || 0) > 0) ||
    element.brightnessEnabled ||
    element.sepiaEnabled ||
    element.grayscaleEnabled ||
    Object.keys(element.filters || {}).length > 0
  );
}

const isGradient = (value) => typeof value === 'string' && value.includes('gradient(');

// Why PowerPoint cannot keep this element as authored. pptx-export gives no
// warning for the flattened cases.
function pptxLosses(element) {
  const losses = [];
  if (element.type === 'figure') {
    if (!PPTX_SHAPES.has(element.subType)) losses.push(`figure "${element.subType}" becomes a picture`);
    if (isGradient(element.fill) || isGradient(element.stroke)) losses.push('a gradient makes this figure a picture');
    if (hasPixelEffects(element)) losses.push('an effect makes this figure a picture');
    if ((element.cornerRadius || 0) > 0 && element.subType !== 'rect') {
      losses.push(`cornerRadius on "${element.subType}" makes it a picture: remove cornerRadius`);
    }
  }
  if (element.type === 'svg') losses.push('svg becomes a picture that PowerPoint cannot recolor or edit');
  if (element.type === 'image') {
    const baked = [
      element.cornerRadius > 0 && 'cornerRadius',
      element.borderSize > 0 && 'border',
      element.clipSrc && 'mask',
      hasPixelEffects(element) && 'effects'
    ].filter(Boolean);
    if (baked.length) losses.push(`${baked.join(', ')} baked into the picture`);
  }
  if (element.type === 'text') {
    if (isGradient(element.fill)) losses.push('gradient text uses its first color');
    if (element.curveEnabled) losses.push('curved text becomes straight');
  }
  if (element.type === 'table' && element.rotation) losses.push('a table cannot rotate in PowerPoint');
  if (element.blendMode && element.blendMode !== 'normal') losses.push(`blend mode "${element.blendMode}" is dropped`);
  for (const animation of element.animations || []) {
    if (PPTX_SKIPPED_ANIMATIONS.has(animation.name)) losses.push(`animation "${animation.name}" is skipped`);
  }
  return losses;
}

function lintDesign(design, fontNames, options = {}) {
  const errors = [];
  const warnings = [];
  const knownFonts = new Set(fontNames.map((font) => font.toLowerCase()));
  const fontDeclarations = Array.isArray(design.fonts) ? design.fonts : [];
  const designFonts = new Set(
    fontDeclarations
      .map((font) => font.fontFamily || font.name)
      .filter(Boolean)
      .map((font) => font.toLowerCase())
  );
  const seenIds = new Map();
  const repeated = new Map();
  const width = design.width || 1080;
  const height = design.height || 1080;
  const pages = Array.isArray(design.pages) ? design.pages : [];
  const brand = brandRules(options.brand ?? design.custom?.brand);
  const pptx = options.target === 'pptx';
  const usedFonts = new Set();
  let animated = false;

  if (!Array.isArray(design.pages)) {
    issue(errors, 'json-shape', null, null, 'design pages must be an array');
  }
  if (design.fonts !== undefined && !Array.isArray(design.fonts)) {
    issue(errors, 'json-shape', null, null, 'design fonts must be an array');
  }
  for (const font of fontDeclarations) {
    if (!font.url && !font.styles?.length) {
      issue(errors, 'font-source', null, null, `font "${font.fontFamily}" has no url or styles`);
    }
  }

  function recordId(id, pageId, kind) {
    if (!id) return;
    if (seenIds.has(id)) {
      issue(
        errors,
        'duplicate-id',
        pageId,
        kind === 'element' ? id : null,
        `id "${id}" is also used on page "${seenIds.get(id)}"`
      );
    } else {
      seenIds.set(id, pageId);
    }
  }

  function checkBrand(colors, fonts, pageId, elementId) {
    if (!brand) return;
    for (const color of new Set(colors)) {
      if (brand.colors && !brand.colors.has(color)) {
        issue(errors, 'brand-color', pageId, elementId, `color ${color} is not in the brand palette`);
      }
    }
    for (const font of new Set(fonts)) {
      if (brand.fonts && !brand.fonts.has(font.toLowerCase())) {
        issue(errors, 'brand-font', pageId, elementId, `font "${font}" is not a brand font`);
      }
    }
  }

  function checkFont(family, text, pageId, elementId) {
    if (!family) return;
    usedFonts.add(family);
    const lower = family.toLowerCase();
    if (!knownFonts.has(lower) && !designFonts.has(lower)) {
      issue(
        warnings,
        'font-unknown',
        pageId,
        elementId,
        `fontFamily "${family}" is not a known Google font or a declared design font. ` +
          'The render stops on it. Declare it in fonts with a url'
      );
    }
    if (NEEDS_SCRIPT_FONT.test(text) && !designFonts.has(lower) && !SCRIPT_FONT.test(family)) {
      issue(
        warnings,
        'font-script',
        pageId,
        elementId,
        `"${family}" may have no glyphs for this script. On a server the text draws as empty ` +
          'boxes. Use a font for the script, such as Noto Sans JP'
      );
    }
  }

  function checkTextContent(node, fit, pageId, elementId, pageHeight) {
    if (PLACEHOLDER_TEXT.test(node.text || '')) {
      issue(errors, 'placeholder-residue', pageId, elementId, 'placeholder text remains');
    }

    const letterSpacing = node.letterSpacing;
    if (Number.isFinite(letterSpacing) && Math.abs(letterSpacing) > 2) {
      issue(
        errors,
        'letter-spacing',
        pageId,
        elementId,
        `letterSpacing ${letterSpacing} uses an unexpected scale`
      );
    }

    const minimumSize = pageHeight / 90;
    if (Number.isFinite(node.fontSize) && node.fontSize < minimumSize) {
      issue(
        warnings,
        'tiny-text',
        pageId,
        elementId,
        `fontSize ${node.fontSize} is less than ${Math.round(minimumSize)}`
      );
    }

    const fitMessage = textFitWarning(fit);
    if (fitMessage) issue(warnings, 'text-fit', pageId, elementId, fitMessage);
  }

  function inspectText(element, pageId, pageHeight) {
    for (const family of nodeFonts(element)) checkFont(family, element.text || '', pageId, element.id);

    const sized = element.textOverflow === 'fit';
    if (sized && !Number.isFinite(element.minFontSize)) {
      issue(
        warnings,
        'fit-floor',
        pageId,
        element.id,
        'textOverflow "fit" has no minFontSize, so long text can shrink until it is unreadable'
      );
    }
    // A fitted element can use its floor. A cut one is short on purpose.
    const cut = element.textOverflow === 'ellipsis' || Number.isFinite(element.maxLines);
    const fit = cut
      ? {}
      : { ...element, fontSize: sized ? (element.minFontSize ?? element.fontSize) : element.fontSize };
    checkTextContent(element, fit, pageId, element.id, pageHeight);
  }

  function inspectTable(element, pageId, pageHeight) {
    const { rows, cols, colWidths = [], rowHeights = [] } = element;
    const cells = Array.isArray(element.cells) ? element.cells : [];
    if (cells.length !== rows * cols) {
      issue(errors, 'table-shape', pageId, element.id, `table has ${cells.length} cells for ${rows} x ${cols}`);
      return;
    }
    for (const [name, list, count] of [['colWidths', colWidths, cols], ['rowHeights', rowHeights, rows]]) {
      const total = list.reduce((sum, value) => sum + value, 0);
      if (list.length !== count || Math.abs(total - 1) > 0.01) {
        issue(errors, 'table-shape', pageId, element.id, `${name} must hold ${count} fractions that sum to 1`);
        return;
      }
    }

    cells.forEach((cell, index) => {
      recordId(cell.id, pageId, 'element');
      if (cell.mergedInto) return;
      const row = Math.floor(index / cols);
      const col = index % cols;
      const sum = (list, start, span) =>
        list.slice(start, start + (span || 1)).reduce((total, value) => total + value, 0);
      const padding = cell.cellPadding ?? element.cellPadding ?? 0;
      const family = cell.fontFamily ?? element.fontFamily;
      checkFont(family, cell.text || '', pageId, element.id);
      checkTextContent(
        { ...cell, fontSize: cell.fontSize ?? element.fontSize, letterSpacing: cell.letterSpacing ?? element.letterSpacing },
        {
          text: cell.text,
          width: sum(colWidths, col, cell.colSpan) * element.width - padding * 2,
          height: sum(rowHeights, row, cell.rowSpan) * element.height - padding * 2,
          fontSize: cell.fontSize ?? element.fontSize,
          lineHeight: cell.lineHeight ?? element.lineHeight,
          letterSpacing: cell.letterSpacing ?? element.letterSpacing
        },
        pageId,
        cell.id || element.id,
        pageHeight
      );
    });
  }

  function inspectAnimations(element, pageId, pageDuration) {
    const animations = Array.isArray(element.animations) ? element.animations : [];
    if (animations.length === 0) return;
    const seen = new Set();
    for (const animation of animations) {
      const { type, name, duration = 500, delay = 0, easing, enabled = true, data } = animation;
      if (!enabled) continue;
      animated = true;
      if (seen.has(type)) {
        issue(warnings, 'animation-duplicate', pageId, element.id, `only the first ${type} animation plays`);
        continue;
      }
      seen.add(type);
      if (!ANIMATION_NAMES[type]?.has(name)) {
        issue(
          errors,
          'animation-name',
          pageId,
          element.id,
          `"${name}" is not valid as ${type}, so the element would not animate`
        );
        continue;
      }
      if (name === 'none') continue;
      if (!(duration > 0) || delay < 0) {
        issue(errors, 'animation-time', pageId, element.id, `${name} needs a positive duration and a delay of 0 or more`);
      }
      if ([...TEXT_TRANSITIONS, ...TEXT_LOOPS].includes(name) && element.type !== 'text') {
        issue(warnings, 'animation-target', pageId, element.id, `${name} is a text preset, so this ${element.type} plays it whole`);
      }
      if (name === 'count' && !/\d/.test(plainText(element.text || ''))) {
        issue(warnings, 'animation-target', pageId, element.id, 'count needs a number in the text');
      }
      if (name === 'kenBurns' && !ASSET_TYPES.has(element.type)) {
        issue(warnings, 'animation-target', pageId, element.id, `kenBurns plays on a crop, so this ${element.type} does not move`);
      }
      if (easing !== undefined && !EASINGS.has(easing)) {
        issue(warnings, 'animation-easing', pageId, element.id, `easing "${easing}" is unknown and plays linear`);
      }
      if (easing === undefined && type !== 'loop') {
        issue(warnings, 'animation-easing', pageId, element.id, `${name} has no easing, so it plays linear`);
      }
      if (data?.direction === undefined && ['move', 'wipe'].includes(name)) {
        issue(warnings, 'animation-direction', pageId, element.id, `${name} has no data.direction, so it uses right`);
      }
    }

    const active = (type) => animations.find((a) => a.type === type && a.enabled !== false && a.name !== 'none');
    const enter = active('enter');
    const exit = active('exit');
    const start = enter?.delay ?? 0;
    const end = pageDuration - (exit?.delay ?? 0);
    const needed = (enter ? (enter.duration ?? 500) : 0) + (exit ? (exit.duration ?? 500) : 0);
    if (needed > end - start) {
      issue(
        warnings,
        'animation-time',
        pageId,
        element.id,
        `enter and exit need ${needed}ms but the element has ${end - start}ms, so both play faster`
      );
    }
    const words = plainText(element.text || '').split(/\s+/).filter(Boolean).length;
    if (words && end - start - needed < words * READING_MS_PER_WORD) {
      issue(
        warnings,
        'reading-time',
        pageId,
        element.id,
        `${words} words rest on screen for ${end - start - needed}ms. Allow ${words * READING_MS_PER_WORD}ms`
      );
    }
  }

  function inspectElement(element, pageId, page) {
    const pageWidth = Number.isFinite(page.width) ? page.width : width;
    const pageHeight = Number.isFinite(page.height) ? page.height : height;
    recordId(element.id, pageId, 'element');
    checkBrand(nodeColors(element), nodeFonts(element), pageId, element.id);
    inspectAnimations(element, pageId, page.duration || DEFAULT_PAGE_DURATION);

    const repeat = element.custom?.repeat;
    if (repeat) {
      const first = repeated.get(repeat);
      if (!first) {
        repeated.set(repeat, element);
      } else {
        const drift = ['x', 'y', 'width', 'height', 'rotation', 'fontSize', 'fontFamily', 'fontWeight', 'fill', 'align', 'src']
          .filter((key) => first[key] !== element[key]);
        if (drift.length) {
          issue(
            warnings,
            'repeat-drift',
            pageId,
            element.id,
            `repeated element "${repeat}" differs from its first use in: ${drift.join(', ')}`
          );
        }
      }
    }

    if (pptx) {
      for (const loss of pptxLosses(element)) issue(warnings, 'pptx-loss', pageId, element.id, loss);
    }

    if (typeof element.src === 'string' && PLACEHOLDER_SOURCE.test(element.src)) {
      issue(
        errors,
        'placeholder-residue',
        pageId,
        element.id,
        `unresolved source placeholder: ${element.src}`
      );
    }

    if (element.type === 'text') inspectText(element, pageId, pageHeight);
    if (element.type === 'table') {
      inspectTable(element, pageId, pageHeight);
      for (const cell of element.cells || []) {
        checkBrand(nodeColors(cell), nodeFonts(cell), pageId, element.id);
      }
    }

    if (ASSET_TYPES.has(element.type)) {
      if (typeof element.src !== 'string' || element.src.trim() === '') {
        issue(errors, 'asset-source', pageId, element.id, 'asset source is empty');
      } else if (!PLACEHOLDER_SOURCE.test(element.src) && !KNOWN_SOURCE.test(element.src)) {
        issue(
          warnings,
          'asset-source',
          pageId,
          element.id,
          `asset source has an unrecognized form: ${element.src}`
        );
      }

      for (const key of ['cropX', 'cropY', 'cropWidth', 'cropHeight']) {
        const value = element[key];
        if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
          issue(errors, 'crop-range', pageId, element.id, `${key} must be from 0 through 1`);
        }
      }
      for (const axis of ['X', 'Y']) {
        const size = axis === 'X' ? 'cropWidth' : 'cropHeight';
        if ((element[`crop${axis}`] ?? 0) + (element[size] ?? 1) > 1.0001) {
          issue(errors, 'crop-range', pageId, element.id, `crop${axis} + ${size} must not exceed 1`);
        }
      }
      if (element.type === 'video' && (element.startTime ?? 0) >= (element.endTime ?? 1)) {
        issue(errors, 'video-trim', pageId, element.id, 'startTime must be less than endTime');
      }
    }

    if (hasBox(element)) {
      if (element.width <= 0 || element.height <= 0) {
        issue(errors, 'element-size', pageId, element.id, 'element width and height must be positive');
      }

      if (!element.rotation) {
        const fullyOutside =
          element.x >= pageWidth ||
          element.y >= pageHeight ||
          element.x + element.width <= 0 ||
          element.y + element.height <= 0;
        const partlyOutside =
          element.x < 0 ||
          element.y < 0 ||
          element.x + element.width > pageWidth ||
          element.y + element.height > pageHeight;

        if (fullyOutside) {
          issue(errors, 'out-of-bounds', pageId, element.id, 'element is outside the canvas');
        } else if (partlyOutside) {
          issue(
            warnings,
            'out-of-bounds',
            pageId,
            element.id,
            'element crosses the canvas edge. Make sure that this is intentional'
          );
        }
      }
    }
  }

  function inspectSiblings(children, pageId, page) {
    const list = Array.isArray(children) ? children : [];
    list.forEach((element, index) => {
      inspectElement(element, pageId, page);

      const covered = list
        .slice(index + 1)
        .some((above) => solidOpaqueRect(above) && contains(above, element));
      if (covered) {
        issue(
          warnings,
          'covered-element',
          pageId,
          element.id,
          'a later opaque rectangle covers this element'
        );
      }

      if (element.type === 'group') inspectSiblings(element.children, pageId, page);
    });
  }

  for (const [index, page] of pages.entries()) {
    const pageId = page.id || `page-${index + 1}`;
    recordId(page.id, pageId, 'page');
    checkBrand(colorsIn(page.background), [], pageId, null);
    if (page.duration !== undefined && !(page.duration > 0)) {
      issue(errors, 'page-duration', pageId, null, `page duration ${page.duration} plays as ${DEFAULT_PAGE_DURATION}ms. Set a positive value`);
    }
    if (pptx) {
      const sized = (value, base) => Number.isFinite(value) && value !== base;
      if (sized(page.width, width) || sized(page.height, height)) {
        issue(errors, 'pptx-page-size', pageId, null, 'all PowerPoint slides use one size, so this page would change');
      }
      if (isGradient(page.background)) {
        issue(warnings, 'pptx-loss', pageId, null, 'a gradient background becomes a picture');
      }
    }
    if (!Array.isArray(page.children) || page.children.length === 0) {
      issue(warnings, 'empty-page', pageId, null, 'page has no elements');
      continue;
    }
    inspectSiblings(page.children, pageId, page);
  }

  if (animated) {
    for (const [index, page] of pages.entries()) {
      let words = 0;
      forEachNode(page.children, (node) => {
        if (node.text) words += plainText(node.text).split(/\s+/).filter(Boolean).length;
      });
      const duration = page.duration || DEFAULT_PAGE_DURATION;
      if (words * READING_MS_PER_WORD > duration) {
        issue(
          warnings,
          'reading-time',
          page.id || `page-${index + 1}`,
          null,
          `page has ${words} words in ${duration}ms. Allow ${words * READING_MS_PER_WORD}ms`
        );
      }
    }
  }

  if (pptx && usedFonts.size) {
    issue(
      warnings,
      'pptx-fonts',
      null,
      null,
      `PowerPoint files do not embed fonts. Viewers without ${[...usedFonts].join(', ')} see a substitute`
    );
  }

  // A missing value keeps its token, so a broken copy looks broken.
  // options.variables is @polotno/schema/variables.
  if (options.variables && Array.isArray(design.pages)) {
    const { getVariables, resolveVariables } = options.variables;
    const pageOf = new Map();
    for (const [index, page] of pages.entries()) {
      forEachNode(page.children, (node) => pageOf.set(node.id, page.id || `page-${index + 1}`));
    }
    const { design: filled, issues } = resolveVariables(design);
    for (const { name, usages } of getVariables(filled).variables) {
      for (const { elementId } of usages) {
        issue(errors, 'variable-unfilled', pageOf.get(elementId) ?? null, elementId, `{{${name}}} prints as written. Give "${name}" a value or a default`);
      }
    }
    for (const item of [...issues, ...getVariables(design).issues]) {
      issue(item.severity === 'error' ? errors : warnings, `variable-${item.reason}`, null, null, `variable "${item.variable}": ${item.reason}`);
    }
  }

  if ((design.dpi || 72) >= 150) {
    const noBleed = pages.every((page) => !page.bleed);
    if (noBleed) {
      issue(
        warnings,
        'print-bleed',
        null,
        null,
        `dpi ${design.dpi} suggests print, but no page sets bleed`
      );
    }
  }

  return { errors, warnings };
}

function parseArgs(argv) {
  const options = { input: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--brand') options.brandFile = argv[++i];
    else if (argv[i] === '--target') options.target = argv[++i];
    else options.unknown = argv[i];
  }
  return options;
}

async function main() {
  const { input, brandFile, target, unknown } = parseArgs(process.argv.slice(2));
  if (!input || unknown || (target && target !== 'pptx') || (brandFile === undefined && process.argv.includes('--brand'))) {
    console.error('Usage: node lint.js <design.json> [--brand <file>] [--target pptx]');
    process.exit(2);
  }

  let design;
  try {
    design = JSON.parse(fs.readFileSync(input, 'utf8'));
  } catch (error) {
    console.log(
      JSON.stringify(
        {
          errors: [{ rule: 'json-parse', pageId: null, message: error.message }],
          warnings: []
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    console.log(
      JSON.stringify(
        {
          errors: [
            { rule: 'json-shape', pageId: null, message: 'design JSON must be an object' }
          ],
          warnings: []
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const fontNames = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'google-fonts.json'), 'utf8')
  );
  const brand = brandFile ? JSON.parse(fs.readFileSync(brandFile, 'utf8')) : undefined;
  ensureDependencies();
  const variables = await import('@polotno/schema/variables');
  const report = lintDesign(design, fontNames, { brand, target, variables });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.errors.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}

module.exports = { ANIMATION_NAMES, forEachNode, lintDesign, plainText, textFitWarning };
