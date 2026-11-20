#!/usr/bin/env node
/**
 * render.js — render a Polotno design. The output extension selects the format.
 *
 * Usage:
 *   node render.js <design.json> <out.png>               preview of every page (~512px)
 *   node render.js <design.json> <out.png> --full        every page at 1:1
 *   node render.js <design.json> <out.png> --page <id>   one page, in any format
 *   node render.js <design.json> <out.png> --sheet       all pages on one image
 *   node render.js <design.json> <out.png> --frames [n]  n moments of each page on one image
 *   node render.js <design.json> <out.pdf>               raster PDF
 *   node render.js <design.json> <out.pdf> --vector      vector PDF, selectable text
 *   node render.js <design.json> <out.pptx>              editable PowerPoint
 *   node render.js <design.json> <out.gif>               animated GIF of all pages
 *   node render.js <design.json> <out.mp4>               MP4 video of all pages
 *
 * A design with several pages writes out-1.png, out-2.png, and so on.
 *
 * Options:
 *   --fps <n>          GIF (default 15) and MP4 (default 30)
 *   --scale <n>        pixel ratio for GIF and MP4 (a GIF defaults to 720px)
 *   --strict           exit with code 3 if a PNG or JPEG render measures an overflow
 *   --dpi <n>, --unit <u>, --bleed, --crop-marks [px]    PDF print options
 *
 * Text follows the editor's default, so a proof shows what the user sees when
 * the design opens: a box grows when its text does not fit. polotno-node would
 * otherwise shrink that text without a word. Every PNG or JPEG render also
 * measures this and reports each overflow.
 *
 * stdout: one JSON report. On failure: JSON on stderr and exit code 1.
 * POLOTNO_UNTRUSTED=1 rejects file: sources and blocks private network requests.
 * POLOTNO_BROWSER_PATH selects a Chromium binary, for example on arm64 Linux.
 * Key resolution: POLOTNO_API_KEY env, else the bundled key (see key.js).
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const { ensureDependencies, importFeature } = require('./dependencies');
const { KEY } = require('./key');
const { forEachNode } = require('./lint');

const PREVIEW_EDGE = 512;
const TILE_EDGE = 360;
const GIF_EDGE = 720;
const DEFAULT_PAGE_DURATION = 5000;
const MIN_FRAME_GAP_MS = 100;
const OVERFLOW_TOLERANCE = 1.03;
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
// Text follows the editor's default in every export that takes this option.
// POLOTNO_UNTRUSTED=1 is for a host that renders JSON it did not write.
const UNTRUSTED = process.env.POLOTNO_UNTRUSTED === '1';
const EXPORT_ATTRS = {
  textOverflow: 'resize',
  ...(UNTRUSTED ? { allowLocalFiles: false, blockPrivateNetwork: true } : {})
};

async function loadPolotno() {
  try {
    // dynamic import: works for both polotno-node v2 (CJS) and v3 (ESM)
    return (await import('polotno-node')).createInstance;
  } catch (error) {
    throw new Error(`polotno-node failed to load: ${error.message}`);
  }
}

function designEdge(design) {
  const w = design.width || design.pages?.[0]?.width || 1080;
  const h = design.height || design.pages?.[0]?.height || 1080;
  return Math.max(w, h);
}

function pixelRatioFor(design, full) {
  if (full) return 1;
  return Math.min(1, Math.max(PREVIEW_EDGE / designEdge(design), 0.05));
}

function pageFile(output, index, count) {
  if (count === 1) return output;
  const { dir, name, ext } = path.parse(output);
  return path.join(dir, `${name}-${index + 1}${ext}`);
}

// A duration of 0 plays as the default, as in the editor.
function pageDuration(page) {
  return page.duration || DEFAULT_PAGE_DURATION;
}

// The page-local moments that show a page's motion: where it starts and ends,
// and the middle and end of each animation.
function momentsOf(page, limit) {
  const duration = pageDuration(page);
  const times = [1, duration - 1];
  forEachNode(page.children, (node) => {
    for (const animation of node.animations || []) {
      if (animation.enabled === false || animation.name === 'none') continue;
      const length = animation.duration ?? 500;
      const delay = animation.delay ?? 0;
      if (animation.type === 'enter') times.push(delay + length / 2, delay + length);
      if (animation.type === 'exit') times.push(duration - delay - length, duration - delay - length / 2);
      if (animation.type === 'loop') times.push(delay + length / 2);
    }
  });

  const moments = [];
  for (const time of times.filter((t) => t >= 1 && t < duration).sort((a, b) => a - b)) {
    if (moments.length === 0 || time - moments.at(-1) >= MIN_FRAME_GAP_MS) moments.push(time);
  }
  if (moments.length <= limit) return moments;
  const step = (moments.length - 1) / (limit - 1);
  return Array.from({ length: limit }, (_, index) => moments[Math.round(index * step)]);
}

function framePlan(design, limit) {
  let start = 0;
  const shots = [];
  design.pages.forEach((page, index) => {
    for (const moment of momentsOf(page, limit)) {
      shots.push({
        pageId: page.id,
        time: start + moment,
        label: `page ${index + 1}  ${(moment / 1000).toFixed(2)}s`
      });
    }
    start += pageDuration(page);
  });
  return shots;
}

// Runs in the page, so it can use only its arguments and page globals.
// instance.run applies its second argument as the render options.
async function composeSheet(json, _attrs, shots, options) {
  store.loadJSON(json);
  await store.waitLoading();
  if (options.timed) store.setTimingPreview('playhead');

  const tiles = [];
  for (const shot of shots) {
    store.selectPage(shot.pageId);
    if (options.timed) store.setCurrentTime(shot.time);
    await store.waitLoading();
    const image = new Image();
    image.src = await store.toDataURL({ pageId: shot.pageId, pixelRatio: options.pixelRatio });
    await image.decode();
    tiles.push({ image, label: shot.label });
  }

  const caption = 22;
  const gap = 8;
  const tileWidth = Math.max(...tiles.map((tile) => tile.image.width));
  const tileHeight = Math.max(...tiles.map((tile) => tile.image.height));
  const columns = Math.min(options.columns, tiles.length);
  const rows = Math.ceil(tiles.length / columns);
  const canvas = document.createElement('canvas');
  canvas.width = columns * (tileWidth + gap) + gap;
  canvas.height = rows * (tileHeight + caption + gap) + gap;
  const context = canvas.getContext('2d');
  context.fillStyle = '#2b2b2b';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = '14px sans-serif';
  tiles.forEach((tile, index) => {
    const x = gap + (index % columns) * (tileWidth + gap);
    const y = gap + Math.floor(index / columns) * (tileHeight + caption + gap);
    context.drawImage(tile.image, x, y + caption);
    context.fillStyle = '#ffffff';
    context.fillText(tile.label, x + 2, y + 15);
  });
  return canvas.toDataURL('image/png');
}

async function writeSheet(instance, design, output, { frames, limit }) {
  const shots = frames
    ? framePlan(design, limit)
    : design.pages.map((page, index) => ({ pageId: page.id, label: `page ${index + 1}` }));
  const url = await instance.run(composeSheet, design, EXPORT_ATTRS, shots, {
    timed: frames,
    pixelRatio: Math.min(1, TILE_EDGE / designEdge(design)),
    columns: frames ? Math.min(limit, 6) : 4
  });
  fs.writeFileSync(output, Buffer.from(url.split(',')[1], 'base64'));
  return { files: [output], pages: design.pages.length, ...(frames ? { frames: shots.length } : {}) };
}

// A copy that shows what cannot fit: fitted text at its floor, and cut text
// uncut. Text that still grows here overflows in the editor.
function overflowProbe(design) {
  const probe = JSON.parse(JSON.stringify(design));
  const checks = new Map();
  for (const page of probe.pages || []) {
    forEachNode(page.children, (node) => {
      if (node.type === 'table') checks.set(node.id, { kind: 'table-overflow', limit: node.height });
      if (node.type !== 'text') return;
      const fit = node.textOverflow === 'fit';
      if (fit && !Number.isFinite(node.minFontSize)) return;
      if (fit) {
        checks.set(node.id, { kind: 'fit-floor', limit: node.height });
        node.fontSize = node.minFontSize;
      } else if (node.maxLines) {
        // A box only grows, so it must start small to show the text's own height.
        const lineHeight = Number.isFinite(node.lineHeight) ? node.lineHeight : 1.2;
        const limit = Math.min(node.height, node.maxLines * node.fontSize * lineHeight);
        checks.set(node.id, { kind: 'text-cut', limit });
        node.height = 1;
      } else {
        const kind = node.textOverflow === 'ellipsis' ? 'text-cut' : 'text-overflow';
        checks.set(node.id, { kind, limit: node.height });
      }
      for (const key of ['textOverflow', 'maxLines', 'minFontSize', 'maxFontSize']) delete node[key];
    });
  }
  return { probe, checks };
}

// Runs in the page. The editor sizes text when it draws a page, so each page
// must become active.
async function layOutEveryPage(json) {
  store.loadJSON(json);
  await store.waitLoading();
  for (const page of store.pages) {
    store.selectPage(page.id);
    await store.waitLoading();
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  return store.toJSON();
}

async function measureOverflow(instance, design) {
  const { probe, checks } = overflowProbe(design);
  if (checks.size === 0) return [];
  const laidOut = await instance.run(layOutEveryPage, probe, EXPORT_ATTRS);
  const heights = new Map();
  for (const page of laidOut.pages) {
    forEachNode(page.children, (node) => heights.set(node.id, node.height));
  }
  const overflow = [];
  for (const page of probe.pages) {
    forEachNode(page.children, (node) => {
      const needed = heights.get(node.id);
      const check = checks.get(node.id);
      if (check && needed > check.limit * OVERFLOW_TOLERANCE + 1) {
        overflow.push({
          kind: check.kind,
          pageId: page.id,
          elementId: node.id,
          boxHeight: Math.round(check.limit),
          neededHeight: Math.ceil(needed)
        });
      }
    });
  }
  return overflow;
}

function selectPages(design, pageId) {
  if (!pageId) return design.pages;
  const pages = design.pages.filter((page) => page.id === pageId);
  if (pages.length === 0) throw new Error(`Page "${pageId}" is not in this design.`);
  return pages;
}

async function writeImages(instance, design, output, { full, jpeg }) {
  const { pages } = design;
  const attrs = {
    ...EXPORT_ATTRS,
    mimeType: jpeg ? 'image/jpeg' : 'image/png',
    pixelRatio: pixelRatioFor(design, full)
  };
  const files = [];
  for (const [index, page] of pages.entries()) {
    const file = pageFile(output, index, pages.length);
    const base64 = await instance.jsonToImageBase64(
      { ...design, pages: [page] },
      { ...attrs, pageId: page.id }
    );
    fs.writeFileSync(file, Buffer.from(base64, 'base64'));
    files.push(file);
  }
  return { files, pages: pages.length, overflow: await measureOverflow(instance, design) };
}

// polotno-node reads file: sources. The PDF and PowerPoint exporters do not, so
// they get the same files as data URLs.
async function withInlineFiles(design) {
  if (UNTRUSTED) return design;
  ensureDependencies();
  const { forEveryUrlField } = await import('@polotno/schema');
  const inlined = structuredClone(design);
  forEveryUrlField(inlined, (node, key, value) => {
    // A font style's src is CSS: url("file:///…").
    const url = /^url\(\s*["']?(.+?)["']?\s*\)$/i.exec(value)?.[1] ?? value;
    if (!url.startsWith('file:')) return;
    const file = fileURLToPath(url);
    const mime = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    node[key] = value.replace(url, `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
  });
  return inlined;
}

function pdfAttrs(args, argValue) {
  const attrs = { ...EXPORT_ATTRS };
  if (argValue('--dpi')) attrs.dpi = Number(argValue('--dpi'));
  if (argValue('--unit')) attrs.unit = argValue('--unit');
  if (args.includes('--bleed')) attrs.includeBleed = true;
  const cropIdx = args.indexOf('--crop-marks');
  if (cropIdx !== -1) {
    const size = Number(args[cropIdx + 1]);
    attrs.cropMarkSize = Number.isFinite(size) ? size : 20;
  }
  return attrs;
}

async function writeVectorPdf(design, output, attrs) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`--vector needs Node.js 22.13 or later. This is ${process.versions.node}.`);
  }
  const { jsonToPDF } = await importFeature('pdf', '@polotno/pdf-export');
  await jsonToPDF(await withInlineFiles(design), output, attrs);
  return { files: [output], pages: design.pages.length, pdf: 'vector' };
}

function slideCounts(xml) {
  const count = (pattern) => (xml.match(pattern) || []).length;
  return { shapes: count(/<p:sp>/g), tables: count(/<a:tbl>/g), pictures: count(/<p:pic>/g) };
}

async function writePptx(design, output) {
  const { jsonToPPTXBytes } = await importFeature('pptx', '@polotno/pptx-export');
  const { default: JSZip } = await importFeature('pptx', 'jszip');

  // The exporter reports what it dropped through console.warn only.
  const warnings = new Set();
  const consoleWarn = console.warn;
  console.warn = (...args) => warnings.add(args.join(' ').replace('[pptx-export] ', ''));
  let bytes;
  try {
    bytes = await jsonToPPTXBytes(await withInlineFiles(design), EXPORT_ATTRS);
  } finally {
    console.warn = consoleWarn;
  }
  fs.writeFileSync(output, bytes);

  const zip = await JSZip.loadAsync(bytes);
  const slides = [];
  for (let index = 1; zip.file(`ppt/slides/slide${index}.xml`); index++) {
    slides.push({
      slide: index,
      ...slideCounts(await zip.file(`ppt/slides/slide${index}.xml`).async('string'))
    });
  }
  return { files: [output], pages: design.pages.length, slides, warnings: [...warnings] };
}

function timedAttrs(design, argValue, defaults) {
  const scale = Number(argValue('--scale'));
  return {
    fps: Number(argValue('--fps')) || defaults.fps,
    pixelRatio: scale > 0 ? scale : defaults.pixelRatio
  };
}

function totalSeconds(design) {
  return design.pages.reduce((sum, page) => sum + pageDuration(page), 0) / 1000;
}

async function writeGif(instance, design, output, argValue) {
  const attrs = timedAttrs(design, argValue, {
    fps: 15,
    pixelRatio: Math.min(1, GIF_EDGE / designEdge(design))
  });
  const base64 = await instance.jsonToGIFBase64(design, { ...attrs, ...EXPORT_ATTRS });
  fs.writeFileSync(output, Buffer.from(base64, 'base64'));
  return { files: [output], pages: design.pages.length, seconds: totalSeconds(design), ...attrs };
}

async function writeVideo(instance, design, output, argValue) {
  const attrs = timedAttrs(design, argValue, { fps: 30, pixelRatio: 1 });
  await instance.jsonToVideoFile(design, output, {
    ...attrs,
    ...EXPORT_ATTRS,
    onProgress: (_fraction, _frameTime, status) => {
      if (status?.state === 'stalled') {
        console.error(`video export is stalled at ${status.stage} for ${status.idleMs}ms`);
      }
    }
  });
  return { files: [output], pages: design.pages.length, seconds: totalSeconds(design), ...attrs };
}

async function main() {
  // polotno-node logs to stdout, which must hold only the report.
  const printReport = console.log;
  console.log = console.error;

  const input = process.argv[2];
  const output = process.argv[3];
  const args = process.argv.slice(4);
  if (!input || !output) {
    console.error('Usage: node render.js <design.json> <out.(png|jpg|pdf|pptx|gif|mp4)> [options]');
    process.exit(2);
  }
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const extension = path.extname(output).toLowerCase();
  const pageId = argValue('--page');
  const source = JSON.parse(fs.readFileSync(input, 'utf8'));
  const design = { ...source, pages: selectPages(source, pageId) };

  let report;
  if (extension === '.pptx') {
    report = await writePptx(design, output);
  } else if (extension === '.pdf' && args.includes('--vector')) {
    report = await writeVectorPdf(design, output, pdfAttrs(args, argValue));
  } else {
    ensureDependencies();
    const createInstance = await loadPolotno();
    const browser = process.env.POLOTNO_BROWSER_PATH;
    // This script makes its calls in order, so one client page serves them all.
    const instance = await createInstance({
      key: KEY,
      useParallelPages: false,
      ...(browser ? { executablePath: browser } : {})
    });
    try {
      if (extension === '.pdf' || args.includes('--pdf')) {
        const base64 = await instance.jsonToPDFBase64(design, pdfAttrs(args, argValue));
        fs.writeFileSync(output, Buffer.from(base64, 'base64'));
        report = { files: [output], pages: design.pages.length, pdf: 'raster' };
      } else if (extension === '.gif') {
        report = await writeGif(instance, design, output, argValue);
      } else if (extension === '.mp4') {
        report = await writeVideo(instance, design, output, argValue);
      } else if (args.includes('--frames') || args.includes('--sheet')) {
        const frames = args.includes('--frames');
        const limit = Math.max(2, Number(argValue('--frames')) || 6);
        report = await writeSheet(instance, design, output, { frames, limit });
      } else {
        report = await writeImages(instance, design, output, {
          full: args.includes('--full'),
          jpeg: extension === '.jpg' || extension === '.jpeg'
        });
      }
    } finally {
      await instance.close();
    }
  }

  printReport(JSON.stringify(report, null, 2));
  // A deliberate ellipsis or line cap is the author's choice, not a defect.
  const defects = report.overflow?.filter(({ kind }) => kind !== 'text-cut') ?? [];
  if (args.includes('--strict') && defects.length) process.exitCode = 3;
}

if (require.main === module) {
  main().catch((error) => {
    const { code, message, details } = error;
    console.error(JSON.stringify({ error: { code, message, details } }, null, 2));
    process.exit(1);
  });
}

module.exports = { momentsOf, overflowProbe };
