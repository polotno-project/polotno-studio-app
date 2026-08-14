#!/usr/bin/env node
/**
 * render.js — render a Polotno design to an image or PDF with polotno-node.
 *
 * Usage:
 *   node render.js <design.json> <out.png>            # preview (default, ~512px)
 *   node render.js <design.json> <out.png> --full     # full resolution (1:1)
 *   node render.js <design.json> <out.pdf> --pdf      # all pages to PDF
 *   node render.js <design.json> <out.png> --page <id>
 *
 * PDF print options (raster PDF — see reference/print-pdf.md):
 *   --dpi <n>          physical-size metadata (default 72)
 *   --unit <u>         pt | mm | cm | in
 *   --bleed            include page bleed (design pages must set `bleed`)
 *   --crop-marks [px]  crop marks (default size 20)
 *
 * Preview mode caps the long edge near 512px so each loop iteration is fast —
 * use it while you iterate, then render --full once at the end. --full renders
 * at 1:1 canvas pixels, whatever the canvas size (print canvases are large).
 *
 * Key resolution: POLOTNO_API_KEY env, else the bundled key (see key.js).
 */
const fs = require('fs');

const { KEY } = require('./key');
const PREVIEW_EDGE = 512;

async function loadPolotno() {
  try {
    // dynamic import: works for both polotno-node v2 (CJS) and v3 (ESM)
    return (await import('polotno-node')).createInstance;
  } catch (e) {
    console.error('polotno-node is not installed. Run: npm install (in this scripts/ folder)');
    process.exit(2);
  }
}

function pixelRatioFor(design, full) {
  if (full) return 1;
  const w = design.width || design.pages?.[0]?.width || 1080;
  const h = design.height || design.pages?.[0]?.height || 1080;
  const ratio = PREVIEW_EDGE / Math.max(w, h);
  return Math.min(1, Math.max(ratio, 0.05));
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
  const argValue = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const pageId = argValue('--page');

  const design = JSON.parse(fs.readFileSync(input, 'utf8'));
  const createInstance = await loadPolotno();
  const instance = await createInstance({ key: KEY });
  try {
    let base64;
    if (pdf) {
      const pdfAttrs = { skipFontError: true };
      if (argValue('--dpi')) pdfAttrs.dpi = Number(argValue('--dpi'));
      if (argValue('--unit')) pdfAttrs.unit = argValue('--unit');
      if (args.includes('--bleed')) pdfAttrs.includeBleed = true;
      const cropIdx = args.indexOf('--crop-marks');
      if (cropIdx !== -1) {
        const size = Number(args[cropIdx + 1]);
        pdfAttrs.cropMarkSize = Number.isFinite(size) ? size : 20;
      }
      if (pageId) pdfAttrs.pageIds = [pageId];
      base64 = await instance.jsonToPDFBase64(design, pdfAttrs);
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
