#!/usr/bin/env node
/**
 * Install and update the npm packages that the scripts use.
 *
 * Usage (build step for unattended hosts):
 *   node dependencies.js            # base packages
 *   node dependencies.js --all      # base packages and every feature
 *
 * This folder holds the packages that every run needs. Each folder in
 * features/ holds one exporter that only some outputs need, so a static design
 * never installs it. See reference/runtimes/backend.md.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { spawnSync } = require('child_process');

const CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 5 * 60 * 1000;
const LOCK_STALE_MS = 10 * 60 * 1000;
const FEATURES = ['pptx', 'pdf'];

function describe(directory) {
  const dependencies = JSON.parse(
    fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
  ).dependencies;
  return {
    directory,
    dependencies,
    policy: JSON.stringify(dependencies),
    nodeModules: path.join(directory, 'node_modules'),
    stateFile: path.join(directory, 'node_modules', '.polotno-dependencies.json'),
    lock: path.join(directory, '.install-lock')
  };
}

function installedVersions({ dependencies, nodeModules }) {
  const versions = {};
  try {
    for (const name of Object.keys(dependencies)) {
      const dependencyFile = path.join(nodeModules, ...name.split('/'), 'package.json');
      versions[name] = JSON.parse(fs.readFileSync(dependencyFile, 'utf8')).version;
    }
    return versions;
  } catch {
    return null;
  }
}

function readState({ stateFile }) {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function needsUpdate(state, policy, versions, now, intervalMs = CHECK_INTERVAL_MS) {
  if (!versions || !state || state.policy !== policy) return true;
  const checkedAt = Date.parse(state.checkedAt);
  const age = now - checkedAt;
  return !Number.isFinite(age) || age < 0 || age >= intervalMs;
}

function writable(directory) {
  try {
    fs.accessSync(directory, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Parallel runs share one node_modules folder, and npm fails if two installs
// write to it at once. The first run installs. The others wait for it.
function withLock({ lock }, action) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > LOCK_STALE_MS) {
        fs.rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out while waiting for another npm install (${lock}).`);
      }
      sleep(500);
    }
  }
  try {
    return action();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function install(project, now, intervalMs) {
  // Another run can finish the install while this run waits for the lock.
  const before = installedVersions(project);
  if (!needsUpdate(readState(project), project.policy, before, now, intervalMs)) {
    return JSON.stringify(before);
  }

  const action = before ? 'update' : 'install';
  console.error(`npm dependency ${action} started in ${project.directory}`);
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(
    npmCommand,
    [action, '--no-save', '--package-lock=false', '--prefer-online', '--no-audit', '--no-fund'],
    // npm writes to stderr only, so stdout stays a clean JSON report.
    { cwd: project.directory, stdio: ['ignore', 2, 2] }
  );
  const versions = installedVersions(project);

  if (!versions) {
    throw new Error(
      `npm ${action} failed in ${project.directory}. Check access to the npm registry and ` +
        'write access to this folder. On an unattended host, install at build time: ' +
        'node scripts/dependencies.js --all'
    );
  }
  if (result.status !== 0) {
    console.error('The npm dependency update failed. The scripts will use the installed versions.');
  }

  const state = {
    checkedAt: new Date(now).toISOString(),
    status: result.status === 0 ? 'ok' : 'failed',
    policy: project.policy,
    versions
  };
  fs.writeFileSync(project.stateFile, `${JSON.stringify(state, null, 2)}\n`);
  return JSON.stringify(versions);
}

function ensureDependencies(options = {}) {
  const now = options.now ?? Date.now();
  const intervalMs = options.intervalMs ?? CHECK_INTERVAL_MS;
  const project = describe(options.directory ?? __dirname);
  const versions = installedVersions(project);

  if (process.env.POLOTNO_DEPENDENCY_UPDATE === 'never') {
    if (!versions) {
      throw new Error(
        `The npm dependencies are missing in ${project.directory}, and automatic updates are ` +
          'disabled. Install them at build time: node scripts/dependencies.js --all'
      );
    }
    return JSON.stringify(versions);
  }

  if (!needsUpdate(readState(project), project.policy, versions, now, intervalMs)) {
    return JSON.stringify(versions);
  }

  // An immutable deployment keeps working with the packages that it shipped.
  if (!writable(project.directory)) {
    if (versions) return JSON.stringify(versions);
    throw new Error(
      `The npm dependencies are missing, and ${project.directory} is read-only. ` +
        'Install them at build time: node scripts/dependencies.js --all'
    );
  }

  return withLock(project, () => install(project, now, intervalMs));
}

// Load a package from a features/ folder. It installs on first use.
async function importFeature(feature, specifier) {
  const directory = path.join(__dirname, 'features', feature);
  ensureDependencies({ directory });
  const resolved = createRequire(path.join(directory, 'package.json')).resolve(specifier);
  return import(pathToFileURL(resolved).href);
}

if (require.main === module) {
  ensureDependencies();
  if (process.argv.includes('--all')) {
    for (const feature of FEATURES) {
      ensureDependencies({ directory: path.join(__dirname, 'features', feature) });
    }
  }
  console.log('polotno-design dependencies are installed');
}

module.exports = { CHECK_INTERVAL_MS, ensureDependencies, importFeature, needsUpdate };
