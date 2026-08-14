#!/usr/bin/env node
/**
 * serve.js — local live editor for a design file (the skill's "local editor
 * server" runtime). Zero dependencies: plain node:http.
 *
 *   node serve.js <design.json> [--port <n>]
 *
 * Opens a full Polotno editor in the human's browser, bound to the file:
 *   - the page reloads when the file changes on disk (your edits),
 *   - the human's edits in the browser save back into the same file.
 * You (the agent) keep working on the file with the other scripts
 * (validate.js, render.js) — re-read the file before each of your writes,
 * the human may have saved changes since.
 *
 * Key resolution: POLOTNO_API_KEY env, else the bundled key (see key.js).
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const { execFileSync } = require('child_process');

const { KEY } = require('./key');

// The editor bundle is built locally from editor-app.js (no CDN at runtime).
// Rebuild when missing or older than its source.
function ensureBundle() {
  const bundle = path.join(__dirname, '.editor/editor.js');
  const source = path.join(__dirname, 'editor-app.js');
  const fresh =
    fs.existsSync(bundle) && fs.statSync(bundle).mtimeMs >= fs.statSync(source).mtimeMs;
  if (fresh) return bundle;
  console.error('building editor bundle (first run, ~10s)…');
  execFileSync(process.execPath, [path.join(__dirname, 'build-editor.mjs')], {
    stdio: ['ignore', 'inherit', 'inherit']
  });
  return bundle;
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('Usage: node serve.js <design.json> [--port <n>]');
  process.exit(2);
}
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? Number(args[portIdx + 1]) : 0;
const designPath = path.resolve(file);

const EMPTY_DESIGN = {
  schemaVersion: 4,
  width: 1080,
  height: 1080,
  fonts: [],
  pages: [{ id: 'p1', background: '#ffffff', children: [] }],
  audios: []
};

if (!fs.existsSync(designPath)) {
  fs.writeFileSync(designPath, JSON.stringify(EMPTY_DESIGN, null, 2));
  console.error(`created ${designPath}`);
}

const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
let lastOwnWrite = '';

// SSE subscribers get one event per external file change; the browser's own
// saves are suppressed by content hash so they don't bounce back as reloads.
const subscribers = new Set();
let watchTimer = null;
fs.watch(path.dirname(designPath), (_event, name) => {
  if (name !== path.basename(designPath)) return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    let content;
    try {
      content = fs.readFileSync(designPath);
    } catch {
      return; // mid-write or deleted; the next event settles it
    }
    if (sha(content) === lastOwnWrite) return;
    for (const res of subscribers) res.write(`data: {"type":"changed"}\n\n`);
  }, 150);
});

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs
      .readFileSync(path.join(__dirname, 'editor.html'), 'utf8')
      .replaceAll('{{POLOTNO_KEY}}', KEY)
      .replaceAll('{{DESIGN_NAME}}', path.basename(designPath));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.method === 'GET' && url.pathname === '/editor.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, '.editor/editor.js')));
  } else if (req.method === 'GET' && url.pathname === '/ui.css') {
    res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
    res.end(fs.readFileSync(require.resolve('polotno/ui.css')));
  } else if (req.method === 'GET' && url.pathname === '/design.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.readFileSync(designPath));
  } else if (req.method === 'POST' && url.pathname === '/design.json') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      try {
        JSON.parse(body.toString('utf8'));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"error":"invalid json"}');
        return;
      }
      lastOwnWrite = sha(body);
      fs.writeFileSync(designPath, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  } else if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(': connected\n\n');
    subscribers.add(res);
    req.on('close', () => subscribers.delete(res));
  } else {
    res.writeHead(404);
    res.end();
  }
});

ensureBundle();

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  // localhost (not 127.0.0.1) so the page's origin matches the usual
  // key-allowed domain.
  console.log(`Polotno editor for ${path.basename(designPath)}: http://localhost:${port}`);
  console.log('Give this URL to the user. Stop with Ctrl-C when the task is done.');
});
