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
 *   Prints top candidates as JSON [{ url, thumb }]. Render or open the thumbs,
 *   pick the best fit, and paste its `url` into the element's `src` yourself.
 *
 *   RESOLVE (auto — first result, for bulk or degraded runs):
 *     node resolve-assets.js resolve <design.json> [output.json]
 *   Swaps every ${photo:query} / ${icon:query} placeholder for the first search
 *   result; drops the element if nothing is found.
 *
 * Query rules that actually return results:
 *   - photo: 3–5 plain words. "latte art coffee cup", NOT a long mood sentence.
 *   - icon:  1–2 nouns. "leaf", "phone". NOT "delicate botanical vine".
 *
 * Key resolution: POLOTNO_API_KEY env, else the public demo key (rate-limited,
 * fine for the loop — set your own key for production).
 */
const fs = require('fs');
const https = require('https');

const DEMO_KEY = 'nFA5H9elEytDyPyvKL7T';
const KEY = process.env.POLOTNO_API_KEY || DEMO_KEY;
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
        url: `${API}/download-nounproject?id=${it.id || it.icon_id}&KEY=${KEY}`,
        thumb: it.thumbnail_url || it.preview_url || it.icon_url,
        id: it.id || it.icon_id,
      })).filter((x) => x.id);
    }
  }
  return [];
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
      const hits = type === 'photo' ? await searchPhoto(query.trim()) : await searchIcon(query.trim());
      const url = hits[0]?.url || null;
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
  } else if (mode === 'resolve') {
    const input = rest[0];
    if (!input) {
      console.error('Usage: node resolve-assets.js resolve <design.json> [output.json]');
      process.exit(2);
    }
    await resolveDesign(input, rest[1] || input);
  } else {
    console.error('Usage:\n  node resolve-assets.js search <photo|icon> "<query>"\n  node resolve-assets.js resolve <design.json> [output.json]');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
