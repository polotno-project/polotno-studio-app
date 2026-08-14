#!/usr/bin/env node
/**
 * resolve-assets.js — find real photos/icons through Polotno's asset proxy.
 *
 * Photos come from Unsplash, icons from Noun Project, both proxied by
 * api.polotno.com and authed with the SAME Polotno key used for rendering.
 * No separate Unsplash/Noun Project keys are needed.
 *
 * Two modes:
 *
 *   SEARCH (preferred — you look, then you pick):
 *     node resolve-assets.js search photo "latte art coffee cup"
 *     node resolve-assets.js search icon "leaf"
 *   Photos print [{ url, thumb }] — paste `url` into the element's `src`.
 *   Icons print [{ id, thumb }] — look at the thumbs, pick one, then:
 *
 *   GET (icons only — prints a self-contained data URL for `src`):
 *     node resolve-assets.js get icon <id>
 *   Icons are inlined as data URLs so design files stay portable and never
 *   embed your API key.
 *
 *   RESOLVE (auto — first result, for bulk or degraded runs):
 *     node resolve-assets.js resolve <design.json> [output.json]
 *   Swaps every ${photo:query} / ${icon:query} placeholder for the first search
 *   result (icons inlined as data URLs); drops the element if nothing is found.
 *
 * Query rules that actually return results:
 *   - photo: 3–5 plain words. "latte art coffee cup", NOT a long mood sentence.
 *   - icon:  1–2 nouns. "leaf", "phone". NOT "delicate botanical vine".
 *
 * Key resolution: POLOTNO_API_KEY env, else the bundled key (see key.js).
 */
const fs = require('fs');
const https = require('https');

const { KEY } = require('./key');
const API = 'https://api.polotno.com/api';
const TOP_N = 6;

function getJSON(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        });
      })
      .on('error', reject);
  });
}

// "modern house exterior golden hour" -> shorter variants, broadest last
function shorten(query) {
  const w = query.trim().split(/\s+/);
  const out = [query];
  for (let len = w.length - 1; len >= 1; len--) out.push(w.slice(0, len).join(' '));
  return out;
}

async function searchPhoto(query) {
  for (const q of shorten(query)) {
    const r = await getJSON(`${API}/get-unsplash?query=${encodeURIComponent(q)}&per_page=${TOP_N}&page=1&KEY=${KEY}`);
    const items = r.results || (Array.isArray(r) ? r : []);
    if (items.length) {
      return items.slice(0, TOP_N).map((it) => ({
        url: it.urls?.regular || it.urls?.full || it.url,
        thumb: it.urls?.thumb || it.urls?.small || it.url,
      })).filter((x) => x.url);
    }
  }
  return [];
}

async function searchIcon(query) {
  for (const q of shorten(query)) {
    const r = await getJSON(`${API}/get-nounproject?query=${encodeURIComponent(q)}&page=1&KEY=${KEY}`);
    const items = r.icons || r.results || (Array.isArray(r) ? r : []);
    if (items.length) {
      return items.slice(0, TOP_N).map((it) => ({
        id: it.id || it.icon_id,
        thumb: it.thumbnail_url || it.preview_url || it.icon_url,
      })).filter((x) => x.id);
    }
  }
  return [];
}

// Fetch a raw body, following one level of redirect / {url} indirection.
function getBody(url, depth = 0) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 3) {
          res.resume();
          return resolve(getBody(res.headers.location, depth + 1));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

// Icon as a self-contained data URL — no API key ends up in the design file.
async function iconDataUrl(id) {
  let body = await getBody(`${API}/download-nounproject?id=${id}&KEY=${KEY}`);
  const text = body.toString('utf8').trim();
  if (text.startsWith('{')) {
    // endpoint answered with JSON pointing at the real file
    try {
      const j = JSON.parse(text);
      const fileUrl = j.url || j.icon_url || j.download_url;
      if (fileUrl) body = await getBody(fileUrl);
    } catch (e) {
      /* fall through with the original body */
    }
  }
  const isSvg = body.toString('utf8', 0, 200).includes('<svg') || text.startsWith('<?xml');
  const mime = isSvg ? 'image/svg+xml' : 'image/png';
  return `data:${mime};base64,${body.toString('base64')}`;
}

const PLACEHOLDER = /^\$\{(photo|icon):(.+)\}$/;

async function resolveDesign(input, output) {
  const design = JSON.parse(fs.readFileSync(input, 'utf8'));
  const cache = new Map();

  async function walk(node) {
    if (typeof node === 'string') {
      const m = node.match(PLACEHOLDER);
      if (!m) return node;
      if (cache.has(node)) return cache.get(node);
      const [, type, query] = m;
      let url = null;
      if (type === 'photo') {
        url = (await searchPhoto(query.trim()))[0]?.url || null;
      } else {
        const hit = (await searchIcon(query.trim()))[0];
        if (hit) url = await iconDataUrl(hit.id);
      }
      cache.set(node, url);
      return url;
    }
    if (Array.isArray(node)) {
      const out = [];
      for (const item of node) out.push(await walk(item));
      return out;
    }
    if (node && typeof node === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(node)) out[k] = await walk(v);
      return out;
    }
    return node;
  }

  const resolved = await walk(design);
  // drop elements whose src failed to resolve
  for (const page of resolved.pages || []) {
    if (page.children) page.children = page.children.filter((c) => c.src !== null);
  }
  fs.writeFileSync(output, JSON.stringify(resolved, null, 2));
  const unresolved = [...cache.values()].filter((v) => v === null).length;
  console.log(JSON.stringify({ resolved: cache.size - unresolved, dropped: unresolved }, null, 2));
}

async function main() {
  const [, , mode, ...rest] = process.argv;
  if (mode === 'search') {
    const [type, ...qparts] = rest;
    const query = qparts.join(' ').replace(/^["']|["']$/g, '');
    if (!['photo', 'icon'].includes(type) || !query) {
      console.error('Usage: node resolve-assets.js search <photo|icon> "<query>"');
      process.exit(2);
    }
    const hits = type === 'photo' ? await searchPhoto(query) : await searchIcon(query);
    console.log(JSON.stringify(hits, null, 2));
    if (type === 'icon' && hits.length) {
      console.log('# pick one, then: node resolve-assets.js get icon <id>  → paste the printed data URL into src');
    }
  } else if (mode === 'get') {
    const [type, id] = rest;
    if (type !== 'icon' || !id) {
      console.error('Usage: node resolve-assets.js get icon <id>');
      process.exit(2);
    }
    console.log(await iconDataUrl(id));
  } else if (mode === 'resolve') {
    const input = rest[0];
    if (!input) {
      console.error('Usage: node resolve-assets.js resolve <design.json> [output.json]');
      process.exit(2);
    }
    await resolveDesign(input, rest[1] || input);
  } else {
    console.error('Usage:\n  node resolve-assets.js search <photo|icon> "<query>"\n  node resolve-assets.js get icon <id>\n  node resolve-assets.js resolve <design.json> [output.json]');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
