#!/usr/bin/env node
/**
 * render.js — render a Polotno design to an image or PDF with polotno-node.
 *
 * Usage:
 *   node render.js <design.json> <out.png>            # preview (default, ~512px)
 *   node render.js <design.json> <out.png> --full     # full resolution
 *   node render.js <design.json> <out.pdf> --pdf      # all pages to PDF
 *   node render.js <design.json> <out.png> --page <id>
 *
 * Preview mode caps the long edge near 512px so each loop iteration is fast —
 * use it while you iterate, then render --full once at the end.
 *
 * Key resolution: POLOTNO_API_KEY env, else the public demo key.
 */
const fs = require('fs');

const DEMO_KEY = 'nFA5H9elEytDyPyvKL7T';
const KEY = process.env.POLOTNO_API_KEY || DEMO_KEY;
const PREVIEW_EDGE = 512;
const FULL_MAX_EDGE = 1500;

function loadPolotno() {
  try {
    return require('polotno-node').createInstance;
  } catch (e) {
    console.error('polotno-node is not installed. Run: npm install (in this scripts/ folder)');
    process.exit(2);
  }
}

function pixelRatioFor(design, full) {
  const w = design.width || design.pages?.[0]?.width || 1080;
  const h = design.height || design.pages?.[0]?.height || 1080;
  const maxEdge = Math.max(w, h);
  const target = full ? FULL_MAX_EDGE : PREVIEW_EDGE;
  // never upscale past 1x for full; for preview, scale down to the target edge
  const ratio = target / maxEdge;
  return full ? Math.min(1, Math.max(ratio, 0.1)) : Math.min(1, Math.max(ratio, 0.05));
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  const args = process.argv.slice(4);
  if (!input || !output) {
    console.error('Usage: node render.js <design.json> <out.(png|pdf)> [--full] [--pdf] [--page <id>]');
    process.exit(2);
  }
  const full = args.includes('--full');
  const pdf = args.includes('--pdf') || output.toLowerCase().endsWith('.pdf');
  const pageIdx = args.indexOf('--page');
  const pageId = pageIdx !== -1 ? args[pageIdx + 1] : undefined;

  const design = JSON.parse(fs.readFileSync(input, 'utf8'));
  const createInstance = loadPolotno();
  const instance = await createInstance({ key: KEY });
  try {
    let base64;
    if (pdf) {
      base64 = await instance.jsonToPDFBase64(design, { skipFontError: true });
    } else {
      const attrs = { mimeType: output.toLowerCase().endsWith('.jpg') || output.toLowerCase().endsWith('.jpeg') ? 'image/jpeg' : 'image/png', pixelRatio: pixelRatioFor(design, full), skipFontError: true };
      if (pageId) attrs.pageId = pageId;
      base64 = await instance.jsonToImageBase64(design, attrs);
    }
    fs.writeFileSync(output, Buffer.from(base64, 'base64'));
    console.log(`wrote ${output} (${pdf ? 'pdf' : full ? 'full' : 'preview'})`);
  } finally {
    await instance.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
