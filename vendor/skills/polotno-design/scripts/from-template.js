#!/usr/bin/env node
/**
 * Build a new design from a template's layout pages.
 *
 * Usage:
 *   node from-template.js <template.json> --list
 *   node from-template.js <template.json> <plan.json> <out.json>
 *
 * A layout is a template page, named by custom.layout or else by its id. Its
 * slots are the template variables that its elements use: {{name}} tokens in
 * text and table cells, and bindings. --list prints each layout and its slots,
 * so you do not need to read the template itself.
 *
 * plan.json:
 *   { "pages": [
 *     { "layout": "title", "slots": { "title": "Q3 review", "photo": "https://…" } },
 *     { "layout": "table", "slots": { "data": [["Name", "Share"], ["A", "22%"]] },
 *       "add": [ …extra elements… ], "background": "#ffffff" }
 *   ] }
 *
 * resolveVariables from @polotno/schema/variables fills each page on its own,
 * so a slot can take a new value on every page. A slot key is the name that
 * --list prints. A string, number, or boolean is the value. These slot values
 * are extras of this script, not of Polotno:
 *   object       "value" fills the variable. The other keys are set on each
 *                element that uses it.
 *   rows array   the cells of each table that uses it, header row first. New
 *                rows copy the template's body rows in turn, so stripes
 *                continue. Columns cannot change.
 *   null         removes each element that uses it
 *
 * Every slot on a page needs a value, unless the template's variables give it
 * a default. Other page keys, such as background and duration, set page
 * properties. Each page gets new element ids. The output is a plain design:
 * values in place, no bindings, no variables. The template's size, fonts, and
 * custom.brand carry over. A template in an older format is migrated first.
 */
const fs = require('fs');

const { ensureDependencies } = require('./dependencies');
const { forEachNode } = require('./lint');

function layoutName(page) {
  return page.custom?.layout ?? page.id;
}

function textCapacity(node) {
  const fontSize = (node.textOverflow === 'fit' && node.minFontSize) || node.fontSize;
  if (!fontSize) return undefined;
  const lineHeight = Number.isFinite(node.lineHeight) ? node.lineHeight : 1.2;
  const perLine = Math.floor(node.width / (fontSize * 0.56));
  const lines = Math.max(1, Math.floor(node.height / (fontSize * lineHeight)));
  return perLine * lines;
}

// Each element by id. A table cell also names its table, which a rows array
// fills and null removes.
function elementsById(children) {
  const byId = new Map();
  const walk = (nodes) => {
    for (const node of nodes ?? []) {
      byId.set(node.id, { node, element: node });
      walk(node.children);
      for (const cell of node.cells ?? []) byId.set(cell.id, { node: cell, element: node });
    }
  };
  walk(children);
  return byId;
}

// The variables that one page uses, with the template's definitions.
function pageVariables(getVariables, template, page) {
  return getVariables({ ...template, pages: [page] }).variables.filter((variable) => variable.usages.length);
}

async function describeLayouts(template) {
  const { getVariables } = await import('@polotno/schema/variables');
  return template.pages.map((page) => {
    const byId = elementsById(page.children);
    const slots = pageVariables(getVariables, template, page).map(({ usages, declared, ...slot }) => {
      for (const { elementId, property } of usages) {
        const { node, element } = byId.get(elementId) ?? {};
        if (!node) continue;
        if (element.type === 'table') {
          Object.assign(slot, { rows: element.rows, cols: element.cols });
        } else if (property === 'text') {
          const capacity = textCapacity(node);
          if (capacity !== undefined) slot.maxChars = Math.min(slot.maxChars ?? capacity, capacity);
        } else if (property === 'src') {
          Object.assign(slot, { width: node.width, height: node.height }, node.fit ? { fit: node.fit } : {});
        }
      }
      return slot;
    });
    return { layout: layoutName(page), slots };
  });
}

function fillTable(table, rows, where, errors) {
  if (rows.some((row) => !Array.isArray(row) || row.length !== table.cols)) {
    errors.push(`${where}: every row needs ${table.cols} cells`);
    return;
  }
  const sameShape = rows.length === table.rows;
  if (!sameShape && table.cells.some((cell) => cell.mergedInto)) {
    errors.push(`${where}: a table with merged cells keeps its ${table.rows} rows`);
    return;
  }
  const bodyRows = Math.max(1, table.rows - 1);
  const sourceRow = (row) => (row < table.rows ? row : 1 + ((row - 1) % bodyRows));
  const renamed = new Map();
  table.cells = rows.flatMap((values, row) =>
    values.map((value, col) => {
      const source = table.cells[Math.min(sourceRow(row), table.rows - 1) * table.cols + col];
      const id = `r${row}c${col}`;
      if (row < table.rows) renamed.set(source.id, id);
      return { ...source, id, text: String(value ?? '') };
    })
  );
  for (const cell of table.cells) {
    if (cell.mergedInto) cell.mergedInto = renamed.get(cell.mergedInto);
  }
  if (!sameShape) {
    table.rows = rows.length;
    table.rowHeights = rows.map(() => 1 / rows.length);
  }
}

// A dotted name reads nested data, so "user.city" fills { user: { city } }.
function setPath(record, name, value) {
  const keys = name.split('.');
  let target = record;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)] = value;
}

function removeElements(children, ids) {
  const kept = children.filter((node) => !ids.has(node.id));
  for (const node of kept) {
    if (Array.isArray(node.children)) node.children = removeElements(node.children, ids);
  }
  return kept;
}

function withPageIds(children, prefix) {
  forEachNode(children, (node) => {
    node.id = `${prefix}-${node.id}`;
    if (node.mergedInto) node.mergedInto = `${prefix}-${node.mergedInto}`;
  });
  return children;
}

function buildPage({ getVariables, readPath, resolveVariables }, template, layouts, entry, index, errors) {
  const { layout, slots = {}, add = [], ...pageProperties } = entry;
  const where = `page ${index + 1} (${layout})`;
  const source = layouts.get(layout);
  if (!source) {
    errors.push(`${where}: no such layout. Available: ${[...layouts.keys()].join(', ')}`);
    return null;
  }

  const page = structuredClone(source);
  const used = new Map(pageVariables(getVariables, template, page).map((variable) => [variable.name, variable]));
  const byId = elementsById(page.children);
  const record = {};
  const removed = new Set();
  for (const [name, value] of Object.entries(slots)) {
    const variable = used.get(name);
    if (!variable) {
      errors.push(`${where}: this layout has no slot "${name}"`);
      continue;
    }
    const targets = variable.usages.map(({ elementId }) => byId.get(elementId)).filter(Boolean);
    const at = `${where} slot "${name}"`;
    if (value === null) {
      for (const { element } of targets) removed.add(element.id);
    } else if (Array.isArray(value)) {
      const other = targets.find(({ element }) => element.type !== 'table');
      if (other) {
        errors.push(`${at}: a ${other.element.type} takes a string or an object. For lines of text, use "\\n"`);
      } else {
        for (const table of new Set(targets.map(({ element }) => element))) fillTable(table, value, at, errors);
      }
    } else if (value && typeof value === 'object') {
      const { value: given, ...properties } = value;
      if (given !== undefined) setPath(record, name, given);
      for (const { node } of targets) Object.assign(node, properties);
    } else {
      setPath(record, name, value);
    }
  }
  page.children = removeElements(page.children ?? [], removed);

  // Read the page again: a removed element or a filled table no longer uses
  // its slot. A stored value is a sample, so only a default counts.
  const remaining = pageVariables(getVariables, template, page);
  const missing = new Set();
  for (const variable of remaining) {
    if (readPath(record, variable.name) != null || variable.default != null) continue;
    missing.add(variable.name);
    errors.push(`${where}: slot "${variable.name}" has no value. Use null to remove the elements that use it`);
  }
  // Only this page's definitions: a required variable of another page is not
  // missing here.
  const names = new Set(remaining.map((variable) => variable.name));
  const variables = template.variables?.filter((variable) => names.has(variable.name));
  const { design, issues } = resolveVariables({ ...template, variables, pages: [page] }, record);
  for (const issue of issues) {
    if (issue.severity === 'error' && !missing.has(issue.variable)) {
      errors.push(`${where} slot "${issue.variable}": ${issue.reason}`);
    }
  }

  const [filled] = design.pages;
  const id = pageProperties.id ?? `p${index + 1}`;
  // A table row can repeat a source cell id, so rename cells inside each table.
  forEachNode(filled.children, (node) => {
    for (const cell of node.cells ?? []) {
      cell.id = `${node.id}-${cell.id}`;
      if (cell.mergedInto) cell.mergedInto = `${node.id}-${cell.mergedInto}`;
    }
  });
  filled.children = withPageIds([...filled.children, ...structuredClone(add)], id);
  return { ...filled, ...pageProperties, id };
}

async function buildDesign(template, plan) {
  const errors = [];
  if (!Array.isArray(plan.pages) || plan.pages.length === 0) {
    return { errors: ['the plan needs a pages array'] };
  }
  const variablesApi = await import('@polotno/schema/variables');
  const layouts = new Map(template.pages.map((page) => [layoutName(page), page]));
  const pages = plan.pages.map((entry, index) => buildPage(variablesApi, template, layouts, entry, index, errors));
  const { variables: _registry, ...plain } = template;
  return { errors, design: { ...plain, pages } };
}

function fail(errors) {
  console.log(JSON.stringify({ valid: false, errors }, null, 2));
  process.exit(1);
}

async function main() {
  const [templateFile, planFile, output] = process.argv.slice(2);
  const list = planFile === '--list';
  if (!templateFile || !planFile || (!list && !output)) {
    console.error(
      'Usage: node from-template.js <template.json> --list\n' +
        '       node from-template.js <template.json> <plan.json> <out.json>'
    );
    process.exit(2);
  }

  ensureDependencies();
  const { migrateDesign } = await import('@polotno/schema');
  const source = JSON.parse(fs.readFileSync(templateFile, 'utf8'));
  const template = migrateDesign(source);

  if (list) {
    const { width, height, fonts, custom } = template;
    console.log(
      JSON.stringify(
        { width, height, fonts: fonts?.map((font) => font.fontFamily), brand: custom?.brand, layouts: await describeLayouts(template) },
        null,
        2
      )
    );
    return;
  }

  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const { errors, design } = await buildDesign(template, plan);
  if (errors.length) fail(errors);

  fs.writeFileSync(output, `${JSON.stringify(design, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        valid: true,
        output,
        pages: design.pages.length,
        ...(source.schemaVersion === template.schemaVersion
          ? {}
          : { migratedFrom: source.schemaVersion ?? 'no version' })
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}

module.exports = { buildDesign, describeLayouts };
