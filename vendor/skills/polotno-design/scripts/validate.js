#!/usr/bin/env node
/**
 * Validate Polotno JSON without changing the source file.
 *
 * Usage:
 *   node validate.js <design.json>
 *   node validate.js <design.json> --mode canonical
 *   node validate.js <design.json> --normalize <output.json>
 *
 * The default mode accepts omitted defaults. The canonical mode requires the
 * complete store.toJSON() shape. --normalize writes canonical JSON only to the
 * explicit output path.
 *
 * Every mode checks schemaVersion. Polotno reads a missing version as format 0
 * and rewrites letter spacing, filters, and animations on load, while the
 * schema itself accepts the file.
 */
const fs = require('fs');
const { ensureDependencies } = require('./dependencies');

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node validate.js <design.json> [--mode partial|canonical] [--normalize <output.json>]'
  );
  process.exit(2);
}

function parseArgs(argv) {
  const input = argv[0];
  if (!input || input.startsWith('--')) usage();

  let mode = 'partial';
  let normalizeOutput;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      mode = argv[++i];
      if (!['partial', 'canonical'].includes(mode)) {
        usage('--mode must be partial or canonical');
      }
    } else if (arg === '--normalize') {
      normalizeOutput = argv[++i];
      if (!normalizeOutput || normalizeOutput.startsWith('--')) {
        usage('--normalize requires an output path');
      }
    } else {
      usage(`Unknown argument: ${arg}`);
    }
  }
  return { input, mode, normalizeOutput };
}

async function loadSchema() {
  try {
    return await import('@polotno/schema');
  } catch (error) {
    throw new Error(`@polotno/schema failed to load: ${error.message}`);
  }
}

function printReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

function pointer(parent, key) {
  const escaped = String(key).replaceAll('~', '~0').replaceAll('/', '~1');
  return `${parent}/${escaped}`;
}

function normalizationDelta(source, normalized) {
  const delta = { defaultsAdded: 0, removedPaths: [], changedPaths: [] };

  function visit(before, after, currentPath) {
    if (Object.is(before, after)) return;

    if (Array.isArray(before) && Array.isArray(after)) {
      const commonLength = Math.min(before.length, after.length);
      for (let i = 0; i < commonLength; i++) {
        visit(before[i], after[i], pointer(currentPath, i));
      }
      if (after.length > before.length) delta.defaultsAdded += after.length - before.length;
      for (let i = after.length; i < before.length; i++) {
        delta.removedPaths.push(pointer(currentPath, i));
      }
      return;
    }

    const beforeIsObject = before && typeof before === 'object' && !Array.isArray(before);
    const afterIsObject = after && typeof after === 'object' && !Array.isArray(after);
    if (beforeIsObject && afterIsObject) {
      for (const key of Object.keys(before)) {
        if (!(key in after)) {
          delta.removedPaths.push(pointer(currentPath, key));
        } else {
          visit(before[key], after[key], pointer(currentPath, key));
        }
      }
      for (const key of Object.keys(after)) {
        if (!(key in before)) delta.defaultsAdded += 1;
      }
      return;
    }

    delta.changedPaths.push(currentPath || '/');
  }

  visit(source, normalized, '');
  return delta;
}

function versionIssues(source, currentVersion, normalizing) {
  const version = source?.schemaVersion;
  const issues = { errors: [], warnings: [] };
  if (version === undefined) {
    const message =
      `schemaVersion is missing, so Polotno reads this file as format 0 and rewrites ` +
      `letterSpacing, filters, and animations. Set schemaVersion to ${currentVersion} for a ` +
      `new design. For an old file, use --normalize.`;
    issues[normalizing ? 'warnings' : 'errors'].push({ path: '/schemaVersion', message });
  } else if (version > currentVersion) {
    issues.errors.push({
      path: '/schemaVersion',
      message: `schemaVersion ${version} is newer than the installed format ${currentVersion}`
    });
  } else if (version < currentVersion) {
    issues.warnings.push({
      path: '/schemaVersion',
      message:
        `schemaVersion ${version} is older than format ${currentVersion}, so Polotno migrates ` +
        `it on load. For a new design, set ${currentVersion}. For an old file, use --normalize ` +
        `and keep the result. Changing only the number leaves old values in place.`
    });
  }
  return issues;
}

async function main() {
  const { input, mode, normalizeOutput } = parseArgs(process.argv.slice(2));
  const sourceText = fs.readFileSync(input, 'utf8');

  let source;
  try {
    source = JSON.parse(sourceText);
  } catch (error) {
    printReport({
      valid: false,
      mode,
      normalized: false,
      errors: [{ path: '', message: `invalid JSON: ${error.message}` }]
    });
    process.exit(1);
  }

  ensureDependencies();
  const { CURRENT_SCHEMA_VERSION, normalizeDesign, validateDesign } = await loadSchema();
  const version = versionIssues(source, CURRENT_SCHEMA_VERSION, Boolean(normalizeOutput));
  let design = source;
  let validationMode = mode;
  let normalized = false;
  let changed = false;
  let delta;

  if (normalizeOutput) {
    try {
      design = normalizeDesign(source);
    } catch (error) {
      printReport({
        valid: false,
        mode: 'canonical',
        normalized: false,
        errors: [{ path: '', message: `normalization failed: ${error.message}` }]
      });
      process.exit(1);
    }
    validationMode = 'canonical';
    normalized = true;
    changed = JSON.stringify(source) !== JSON.stringify(design);
    delta = normalizationDelta(source, design);
  }

  const result = validateDesign(design, { mode: validationMode });
  const errors = [...version.errors, ...(result.errors || [])];
  const valid = errors.length === 0;
  const report = {
    valid,
    mode: validationMode,
    normalized,
    ...(normalized ? { changed } : {}),
    ...(normalized ? { delta } : {}),
    ...(normalizeOutput && valid ? { output: normalizeOutput } : {}),
    errors,
    warnings: version.warnings
  };

  if (normalizeOutput && valid) {
    fs.writeFileSync(normalizeOutput, `${JSON.stringify(design, null, 2)}\n`);
  }

  printReport(report);
  process.exit(valid ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}

module.exports = { normalizationDelta, parseArgs, versionIssues };
