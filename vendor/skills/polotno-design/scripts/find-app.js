#!/usr/bin/env node
/**
 * Report whether the Polotno desktop app is running. This script reads the
 * app's discovery file and calls its health URL. It never prints the token.
 *
 * Usage:
 *   node find-app.js    # {"running":true,"url":"…"} or {"running":false}
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function discoveryFile(platform = process.platform, home = os.homedir(), env = process.env) {
  if (platform === 'darwin') {
    return path.join(home, 'Library/Application Support/polotno-app/mcp.json');
  }
  if (platform === 'win32') return path.join(env.APPDATA || '', 'polotno-app/mcp.json');
  return path.join(home, '.config/polotno-app/mcp.json');
}

async function main() {
  let discovery;
  try {
    discovery = JSON.parse(fs.readFileSync(discoveryFile(), 'utf8'));
  } catch {
    console.log(JSON.stringify({ running: false }));
    return;
  }
  // The discovery file can outlive the app, so only the health URL decides.
  try {
    const response = await fetch(`${discovery.url}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    console.log(JSON.stringify({ running: response.ok, url: discovery.url }));
  } catch {
    console.log(JSON.stringify({ running: false }));
  }
}

if (require.main === module) main();

module.exports = { discoveryFile };
