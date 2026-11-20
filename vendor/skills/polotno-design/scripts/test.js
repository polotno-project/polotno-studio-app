#!/usr/bin/env node
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { CHECK_INTERVAL_MS, ensureDependencies, needsUpdate } = require('./dependencies');
const { discoveryFile } = require('./find-app');
const { buildDesign, describeLayouts } = require('./from-template');
const { ANIMATION_NAMES, forEachNode, lintDesign, textFitWarning } = require('./lint');
const { momentsOf, overflowProbe } = require('./render');

process.env.POLOTNO_DEPENDENCY_UPDATE = 'never';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'polotno-design-test-'));

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

const rules = (issues) => new Set(issues.map((item) => item.rule));
const page = (children, extra = {}) => ({ id: 'p', background: '#ffffff', children, ...extra });
const lintPage = (children, options, pageExtra, root = {}) =>
  lintDesign({ schemaVersion: 5, width: 1000, height: 1000, pages: [page(children, pageExtra)], ...root }, ['Inter'], options);
const text = (extra = {}) => ({
  id: 'text',
  type: 'text',
  x: 10,
  y: 10,
  width: 500,
  height: 100,
  text: 'Hello',
  fontSize: 40,
  fontFamily: 'Inter',
  ...extra
});
const figure = (extra = {}) => ({
  id: 'figure',
  type: 'figure',
  subType: 'rect',
  x: 10,
  y: 10,
  width: 100,
  height: 100,
  fill: '#123456',
  ...extra
});
const animation = (type, name, extra = {}) => ({
  type,
  name,
  duration: 500,
  delay: 0,
  enabled: true,
  easing: 'easeOut',
  data: {},
  ...extra
});

function write(name, value) {
  const file = path.join(temporaryDirectory, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return file;
}

async function main() {
  const variablesApi = await import('@polotno/schema/variables');
  assert.equal(CHECK_INTERVAL_MS, 7 * 24 * 60 * 60 * 1000);
  const now = Date.parse('2026-08-18T00:00:00.000Z');
  const policy = '{"polotno":"^4.8.0"}';
  const versions = { polotno: '4.8.0' };
  const freshState = { checkedAt: new Date(now).toISOString(), policy };
  assert.equal(needsUpdate(null, policy, versions, now), true);
  assert.equal(needsUpdate(freshState, policy, null, now), true);
  assert.equal(needsUpdate(freshState, 'changed', versions, now), true);
  assert.equal(needsUpdate(freshState, policy, versions, now), false);
  assert.equal(
    needsUpdate(freshState, policy, versions, now + CHECK_INTERVAL_MS),
    true
  );

  const source = {
    schemaVersion: 5,
    width: 1080,
    height: 1080,
    unknownRootProperty: 'remove only in explicit output',
    pages: [
      {
        id: 'page-1',
        background: '#ffffff',
        children: [
          {
            id: 'title',
            type: 'text',
            x: 80,
            y: 80,
            width: 700,
            height: 120,
            text: 'A valid design',
            fontSize: 72,
            fontFamily: 'Inter'
          }
        ]
      }
    ]
  };
  const sourceFile = write('source.json', source);
  const originalText = fs.readFileSync(sourceFile, 'utf8');

  const validation = run('validate.js', [sourceFile]);
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), originalText);

  const canonicalFile = path.join(temporaryDirectory, 'canonical.json');
  const normalization = run('validate.js', [sourceFile, '--normalize', canonicalFile]);
  assert.equal(normalization.status, 0, normalization.stderr || normalization.stdout);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), originalText);
  assert.equal(fs.existsSync(canonicalFile), true);
  const normalizationReport = JSON.parse(normalization.stdout);
  assert.equal(normalizationReport.changed, true);
  assert.equal(
    normalizationReport.delta.removedPaths.includes('/unknownRootProperty'),
    true
  );

  const canonicalValidation = run('validate.js', [canonicalFile, '--mode', 'canonical']);
  assert.equal(
    canonicalValidation.status,
    0,
    canonicalValidation.stderr || canonicalValidation.stdout
  );

  const invalidFile = write('invalid.json', '{invalid');
  const invalidText = fs.readFileSync(invalidFile, 'utf8');
  const invalidValidation = run('validate.js', [invalidFile]);
  assert.equal(invalidValidation.status, 1);
  assert.equal(fs.readFileSync(invalidFile, 'utf8'), invalidText);

  const nullFile = write('null.json', 'null');
  const nullLint = run('lint.js', [nullFile]);
  assert.equal(nullLint.status, 1);
  assert.equal(JSON.parse(nullLint.stdout).errors[0].rule, 'json-shape');

  const malformedArraysFile = write('malformed-arrays.json', {
    schemaVersion: 5,
    fonts: {},
    pages: {}
  });
  const malformedArraysLint = run('lint.js', [malformedArraysFile]);
  assert.equal(malformedArraysLint.status, 1);
  assert.equal(
    JSON.parse(malformedArraysLint.stdout).errors.every((error) => error.rule === 'json-shape'),
    true
  );

  assert.notEqual(
    textFitWarning({
      text: 'oneverylongword',
      width: 20,
      height: 20,
      fontSize: 20,
      lineHeight: 1.2,
      letterSpacing: 0
    }),
    null
  );

  const badDesign = {
    schemaVersion: 5,
    width: 100,
    height: 100,
    dpi: 300,
    pages: [
      {
        id: 'page-1',
        children: [
          {
            id: 'duplicate',
            type: 'group',
            children: [
              {
                id: 'nested-image',
                type: 'image',
                x: 0,
                y: 0,
                width: 50,
                height: 50,
                src: '${photo:test}'
              }
            ]
          },
          {
            id: 'duplicate',
            type: 'text',
            x: 120,
            y: 0,
            width: 20,
            height: 10,
            text: 'Lorem ipsum text that cannot fit',
            fontSize: 20,
            fontFamily: 'Unknown Test Font',
            letterSpacing: 10
          },
          {
            id: 'empty-asset',
            type: 'svg',
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            src: ''
          }
        ]
      }
    ]
  };
  const badFile = write('bad.json', badDesign);
  const lint = run('lint.js', [badFile]);
  assert.equal(lint.status, 1, lint.stderr || lint.stdout);
  const lintReport = JSON.parse(lint.stdout);
  const errorRules = new Set(lintReport.errors.map((error) => error.rule));
  const warningRules = new Set(lintReport.warnings.map((warning) => warning.rule));
  assert.equal(errorRules.has('duplicate-id'), true);
  assert.equal(errorRules.has('placeholder-residue'), true);
  assert.equal(errorRules.has('asset-source'), true);
  assert.equal(errorRules.has('out-of-bounds'), true);
  assert.equal(warningRules.has('font-unknown'), true);
  assert.equal(warningRules.has('text-fit'), true);
  assert.equal(warningRules.has('print-bleed'), true);

  // schemaVersion: a missing version rewrites values on load, so it must fail.
  const { schemaVersion: _version, ...unversioned } = source;
  const unversionedFile = write('unversioned.json', unversioned);
  const unversionedRun = run('validate.js', [unversionedFile]);
  assert.equal(unversionedRun.status, 1);
  assert.equal(JSON.parse(unversionedRun.stdout).errors[0].path, '/schemaVersion');

  const migrated = path.join(temporaryDirectory, 'migrated.json');
  const migration = run('validate.js', [unversionedFile, '--normalize', migrated]);
  assert.equal(migration.status, 0, migration.stdout);
  assert.equal(JSON.parse(migration.stdout).warnings[0].path, '/schemaVersion');

  const olderRun = run('validate.js', [write('older.json', { ...source, schemaVersion: 4 })]);
  assert.equal(olderRun.status, 0);
  assert.equal(JSON.parse(olderRun.stdout).warnings[0].path, '/schemaVersion');

  const newerRun = run('validate.js', [write('newer.json', { ...source, schemaVersion: 99 })]);
  assert.equal(newerRun.status, 1);

  // Tables.
  const table = (cells, extra = {}) => ({
    id: 'table',
    type: 'table',
    x: 10,
    y: 10,
    width: 400,
    height: 100,
    rows: 1,
    cols: 2,
    colWidths: [0.5, 0.5],
    rowHeights: [1],
    cells,
    fontSize: 30,
    fontFamily: 'Inter',
    ...extra
  });
  const cell = (id, cellText, extra = {}) => ({ id, type: 'tablecell', text: cellText, ...extra });
  const longCell = 'A cell with far more words than this small box can show at this size in any font';
  assert.equal(rules(lintPage([table([cell('a', 'A'), cell('b', 'B')])]).warnings).has('text-fit'), false);
  assert.equal(rules(lintPage([table([cell('a', 'A'), cell('b', longCell)])]).warnings).has('text-fit'), true);
  assert.equal(rules(lintPage([table([cell('a', 'A')])]).errors).has('table-shape'), true);
  assert.equal(
    rules(lintPage([table([cell('a', 'A'), cell('b', 'B')], { colWidths: [0.5, 0.2] })]).errors).has('table-shape'),
    true
  );
  assert.equal(
    rules(lintPage([table([cell('a', 'A'), cell('b', 'B', { fontFamily: 'No Such Font' })])]).warnings).has('font-unknown'),
    true
  );

  // Text sizing.
  const longText = 'Long text '.repeat(40);
  assert.equal(rules(lintPage([text({ text: longText })]).warnings).has('text-fit'), true);
  assert.equal(
    rules(lintPage([text({ text: longText, textOverflow: 'fit', minFontSize: 8 })]).warnings).has('text-fit'),
    false
  );
  assert.equal(
    rules(lintPage([text({ text: longText, textOverflow: 'fit', minFontSize: 36 })]).warnings).has('text-fit'),
    true
  );
  assert.equal(rules(lintPage([text({ textOverflow: 'fit' })]).warnings).has('fit-floor'), true);
  assert.equal(rules(lintPage([text({ text: longText, maxLines: 2 })]).warnings).has('text-fit'), false);
  assert.equal(
    textFitWarning({ text: '<p><strong>Short</strong></p>', width: 300, height: 60, fontSize: 40 }),
    null
  );

  // Fonts.
  assert.equal(rules(lintPage([text({ text: 'こんにちは' })]).warnings).has('font-script'), true);
  assert.equal(
    rules(lintDesign({ pages: [page([text({ text: 'こんにちは', fontFamily: 'Noto Sans JP' })])] }, ['Noto Sans JP']).warnings).has('font-script'),
    false
  );
  assert.equal(
    rules(lintPage([text({ fontFamily: 'Acme' })], {}, {}, { fonts: [{ fontFamily: 'Acme', url: '' }] }).errors).has('font-source'),
    true
  );
  assert.equal(
    rules(lintPage([text({ fontFamily: 'Acme' })], {}, {}, { fonts: [{ fontFamily: 'Acme', url: 'https://a.test/a.woff2' }] }).warnings).has('font-unknown'),
    false
  );

  // Per-page size.
  assert.equal(
    rules(lintPage([text({ x: 1500 })], {}, { width: 2000 }).errors).has('out-of-bounds'),
    false
  );

  // Brand rules, from the design, a brand file, and a template.
  const brand = { colors: ['#123456', '#ffffff', 'rgb(0, 0, 0)'], fonts: ['Inter'] };
  const onBrand = [text({ fill: 'black' }), figure({ fill: 'linear-gradient(90deg, #123456 0%, #ffffff 100%)' })];
  assert.deepEqual(lintPage(onBrand, { brand }).errors, []);
  const offBrand = lintPage([text({ fill: '#ff0000', fontFamily: 'Poppins' })], {}, {}, { custom: { brand } });
  assert.equal(rules(offBrand.errors).has('brand-color'), true);
  assert.equal(rules(offBrand.errors).has('brand-font'), true);
  assert.equal(rules(lintPage([], { brand }, { background: '#ff0000' }).errors).has('brand-color'), true);
  assert.equal(
    rules(lintPage([text({ text: '<p style="color: #ff0000">Hi</p>', fill: '#123456' })], { brand }).errors).has('brand-color'),
    true
  );
  const templateBrand = { pages: [page([text({ fill: '#123456' })])] };
  assert.deepEqual(lintPage([text({ fill: '#123456' })], { brand: templateBrand }).errors, []);
  assert.equal(
    rules(lintPage([text({ fill: '#654321' })], { brand: templateBrand }).errors).has('brand-color'),
    true
  );
  // An editor save fills in colors that do not draw.
  const inertColors = text({
    fill: '#123456',
    stroke: '#ff0000',
    strokeWidth: 0,
    backgroundColor: '#00ff00',
    borderColor: '#0000ff',
    shadowColor: '#ff00ff'
  });
  assert.deepEqual(lintPage([inertColors], { brand }).errors, []);
  assert.equal(
    rules(lintPage([{ ...inertColors, strokeWidth: 2 }], { brand }).errors).has('brand-color'),
    true
  );
  // A template's declared palette wins over the colors its pages happen to use.
  const declared = { custom: { brand: { colors: ['#ffffff', '#123456', '#13a89e'], fonts: ['Inter'] } }, pages: [page([text({ fill: '#123456' })])] };
  assert.deepEqual(lintPage([text({ fill: '#13A89E' })], { brand: declared }).errors, []);
  const brandFile = write('brand.json', brand);
  const brandedFile = write('branded.json', { schemaVersion: 5, pages: [page([text({ fill: '#ff0000' })])] });
  assert.equal(run('lint.js', [brandedFile, '--brand', brandFile]).status, 1);
  assert.equal(run('lint.js', [brandedFile]).status, 0);

  // Repeated elements.
  const footer = (id, x) => text({ id, x, custom: { repeat: 'footer' } });
  const repeatPages = (x) => ({
    pages: [
      { id: 'a', children: [footer('f1', 10)] },
      { id: 'b', children: [footer('f2', x)] }
    ]
  });
  assert.equal(rules(lintDesign(repeatPages(10), ['Inter']).warnings).has('repeat-drift'), false);
  assert.equal(rules(lintDesign(repeatPages(30), ['Inter']).warnings).has('repeat-drift'), true);

  // PowerPoint losses. The figure cases mirror pptx-export's figure.ts.
  const pptx = { target: 'pptx' };
  const losses = (element) => lintPage([element], pptx).warnings.filter((item) => item.rule === 'pptx-loss');
  assert.equal(losses(figure()).length, 0);
  assert.equal(losses(figure({ cornerRadius: 8 })).length, 0);
  assert.equal(losses(figure({ subType: 'circle' })).length, 0);
  assert.equal(losses(figure({ subType: 'circle', cornerRadius: 8 })).length, 1);
  assert.equal(losses(figure({ subType: 'blob1' })).length, 1);
  assert.equal(losses(figure({ fill: 'linear-gradient(90deg, #000 0%, #fff 100%)' })).length, 1);
  assert.equal(losses(figure({ blurEnabled: true, blurRadius: 4 })).length, 1);
  assert.equal(losses({ id: 's', type: 'svg', x: 0, y: 0, width: 9, height: 9, src: 'data:x' }).length, 1);
  assert.equal(losses(text({ animations: [animation('enter', 'count')], text: '100' })).length, 1);
  assert.equal(rules(lintPage([figure({ subType: 'blob1' })]).warnings).has('pptx-loss'), false);
  assert.equal(rules(lintPage([text()], pptx, { width: 800 }).errors).has('pptx-page-size'), true);
  assert.equal(rules(lintPage([text()], pptx).warnings).has('pptx-fonts'), true);

  // Animations.
  const animated = (animations, extra) => lintPage([text({ animations, ...extra })], {}, { duration: 5000 });
  assert.deepEqual(animated([animation('enter', 'fade')]).errors, []);
  assert.equal(rules(animated([animation('enter', 'slideIn')]).errors).has('animation-name'), true);
  assert.equal(rules(animated([animation('loop', 'fade')]).errors).has('animation-name'), true);
  assert.equal(rules(animated([animation('enter', 'fade', { duration: 0 })]).errors).has('animation-time'), true);
  assert.equal(rules(animated([animation('enter', 'fade', { easing: undefined })]).warnings).has('animation-easing'), true);
  assert.equal(rules(animated([animation('enter', 'fade', { easing: 'bouncy' })]).warnings).has('animation-easing'), true);
  assert.equal(rules(animated([animation('enter', 'count')], { text: 'No digits' }).warnings).has('animation-target'), true);
  assert.equal(rules(animated([animation('loop', 'kenBurns')]).warnings).has('animation-target'), true);
  assert.equal(
    rules(animated([animation('enter', 'fade', { duration: 3000 }), animation('exit', 'fade', { duration: 3000 })]).warnings).has('animation-time'),
    true
  );
  assert.equal(
    rules(lintPage([figure({ animations: [animation('enter', 'wordRise')] })]).warnings).has('animation-target'),
    true
  );
  assert.equal(
    rules(animated([animation('enter', 'fade', { duration: 4500 })], { text: 'Words '.repeat(10) }).warnings).has('reading-time'),
    true
  );
  assert.equal(rules(lintPage([text()], {}, { duration: 1000 }).warnings).has('reading-time'), false);

  assert.equal(rules(lintPage([text()], {}, { duration: 0 }).errors).has('page-duration'), true);
  assert.deepEqual(momentsOf(page([], { duration: 0 }), 4), [1, 4999]);

  // Motion sampling.
  const moments = momentsOf(
    page([text({ animations: [animation('enter', 'fade', { delay: 200, duration: 800 }), animation('exit', 'fade', { duration: 400 })] })], { duration: 3000 }),
    10
  );
  assert.deepEqual(moments, [1, 600, 1000, 2600, 2800, 2999]);
  const fewMoments = momentsOf(page([text({ animations: [animation('enter', 'fade', { delay: 200, duration: 800 }), animation('exit', 'fade', { duration: 400 })] })], { duration: 3000 }), 3);
  assert.equal(fewMoments.length, 3);
  assert.equal(fewMoments[0], 1);
  assert.equal(fewMoments.at(-1), 2999);

  // Overflow probe.
  const { probe, checks } = overflowProbe({
    pages: [
      page([
        text({ id: 'plain' }),
        text({ id: 'fitted', textOverflow: 'fit', minFontSize: 20 }),
        text({ id: 'unbounded', textOverflow: 'fit' }),
        text({ id: 'cut', textOverflow: 'ellipsis' })
      ])
    ]
  });
  assert.equal(checks.get('plain').kind, 'text-overflow');
  assert.equal(checks.get('fitted').kind, 'fit-floor');
  assert.equal(checks.has('unbounded'), false);
  assert.equal(checks.get('cut').kind, 'text-cut');
  assert.equal(probe.pages[0].children[1].fontSize, 20);
  assert.equal('textOverflow' in probe.pages[0].children[3], false);
  const capped = overflowProbe({ pages: [page([text({ id: 'capped', height: 500, fontSize: 40, lineHeight: 1, maxLines: 2 })])] });
  assert.deepEqual(capped.checks.get('capped'), { kind: 'text-cut', limit: 80 });
  assert.equal(capped.probe.pages[0].children[0].height, 1);

  // Templates. Slots are template variables, and each page is filled on its own.
  const template = {
    schemaVersion: 5,
    width: 1000,
    height: 1000,
    custom: { brand },
    variables: [
      { name: 'title', value: 'Sample title' },
      { name: 'subtitle', default: 'Default subtitle' },
      { name: 'author', required: true }
    ],
    pages: [
      page(
        [
          text({ id: 'title', text: '<p>Hi <strong>{{title}}</strong></p>' }),
          text({ id: 'subtitle', y: 200, text: '{{ subtitle }}' }),
          figure({ id: 'logo', custom: { repeat: 'logo' } }),
          { id: 'photo', type: 'image', x: 0, y: 0, width: 9, height: 9, src: 'https://a.test/a.png', bindings: { src: 'photo' }, fit: 'cover' },
          table([cell('h1', '{{data}}', { fontWeight: '700' }), cell('h2', 'B', { fontWeight: '700' }), cell('b1', 'C'), cell('b2', 'D')], {
            rows: 2,
            rowHeights: [0.5, 0.5]
          })
        ],
        { id: 'one', custom: { layout: 'content' } }
      ),
      page([text({ id: 'quote', text: '{{quote}} by {{author}}' })], { id: 'two', custom: { layout: 'quote' } })
    ]
  };
  const summary = await describeLayouts(template);
  assert.deepEqual(summary.map((item) => item.layout), ['content', 'quote']);
  const slots = Object.fromEntries(summary[0].slots.map((slot) => [slot.name, slot]));
  assert.deepEqual(Object.keys(slots).sort(), ['data', 'photo', 'subtitle', 'title']);
  assert.equal(slots.title.maxChars > 0, true);
  assert.equal(slots.subtitle.default, 'Default subtitle');
  assert.deepEqual([slots.photo.type, slots.photo.fit], ['image', 'cover']);
  assert.deepEqual([slots.data.rows, slots.data.cols], [2, 2]);
  assert.deepEqual(summary[1].slots.map((slot) => slot.name).sort(), ['author', 'quote']);

  const plan = {
    pages: [
      { layout: 'content', slots: { title: 'First', photo: null, data: [['H', 'I'], ['1', '2'], ['3', '4'], ['5', '6']] } },
      {
        layout: 'content',
        slots: {
          title: { value: 'Second', fill: '#ffffff' },
          subtitle: 'Own subtitle',
          photo: { value: 'https://a.test/b.png', focus: { x: 0.5, y: 0.2 } },
          data: [['H', 'I'], ['1', '2']]
        },
        background: '#123456'
      },
      { layout: 'quote', slots: { quote: 'Less is more', author: 'Rams' } }
    ]
  };
  const built = await buildDesign(template, plan);
  assert.deepEqual(built.errors, []);
  const ids = [];
  for (const builtPage of built.design.pages) {
    ids.push(builtPage.id);
    forEachNode(builtPage.children, (node) => ids.push(node.id));
  }
  assert.equal(new Set(ids).size, ids.length);
  const [first, second, third] = built.design.pages;
  const element = (builtPage, id) => builtPage.children.find((node) => node.id === `${builtPage.id}-${id}`);
  assert.equal(element(first, 'title').text, '<p>Hi <strong>First</strong></p>');
  assert.equal(element(second, 'title').text, '<p>Hi <strong>Second</strong></p>');
  assert.equal(element(second, 'title').fill, '#ffffff');
  assert.equal(element(first, 'subtitle').text, 'Default subtitle');
  assert.equal(element(second, 'subtitle').text, 'Own subtitle');
  assert.equal(third.children[0].text, 'Less is more by Rams');
  assert.equal(element(first, 'photo'), undefined);
  const photo = element(second, 'photo');
  assert.deepEqual([photo.src, photo.fit, photo.focus], ['https://a.test/b.png', 'cover', { x: 0.5, y: 0.2 }]);
  assert.equal(JSON.stringify(built.design).includes('"bindings"'), false);
  assert.equal('variables' in built.design, false);
  const firstTable = first.children.find((node) => node.type === 'table');
  assert.equal(firstTable.rows, 4);
  assert.equal(firstTable.cells.length, 8);
  assert.equal(firstTable.cells[0].text, 'H');
  assert.equal(firstTable.rowHeights.length, 4);
  assert.equal(firstTable.cells[0].fontWeight, '700');
  assert.equal(firstTable.cells[6].fontWeight, undefined);
  assert.equal(second.background, '#123456');
  assert.deepEqual(built.design.custom, template.custom);
  assert.deepEqual(lintDesign(built.design, ['Inter'], { variables: variablesApi }).errors, []);
  assert.equal(template.pages[0].children[0].text, '<p>Hi <strong>{{title}}</strong></p>');

  // Merged cells keep pointing at their anchor through both renames.
  const mergedTemplate = {
    schemaVersion: 5,
    pages: [
      page(
        [
          table(
            [cell('anchor', '{{data}}', { colSpan: 2 }), cell('hidden', '', { mergedInto: 'anchor' }), cell('c', 'C'), cell('d', 'D')],
            { rows: 2, rowHeights: [0.5, 0.5] }
          )
        ],
        { id: 'one' }
      )
    ]
  };
  const merged = await buildDesign(mergedTemplate, { pages: [{ layout: 'one', slots: { data: [['A', ''], ['C', 'D']] } }] });
  assert.deepEqual(merged.errors, []);
  const mergedCells = merged.design.pages[0].children[0].cells;
  assert.equal(mergedCells[1].mergedInto, mergedCells[0].id);

  const failure = async (entry) => (await buildDesign(template, { pages: [entry] })).errors.join(' ');
  const content = (extra) => ({ layout: 'content', slots: { title: 'x', photo: null, data: [['a', 'b']], ...extra } });
  assert.match(await failure({ layout: 'missing' }), /no such layout/);
  // A stored value is a sample: it never fills a page.
  assert.match(await failure({ layout: 'content', slots: { photo: null, data: [['a', 'b']] } }), /slot "title" has no value/);
  assert.match(await failure({ layout: 'content', slots: { title: 'x', data: [['a', 'b']] } }), /slot "photo" has no value/);
  assert.match(await failure(content({ ghost: 1 })), /no slot "ghost"/);
  assert.match(await failure({ layout: 'quote', slots: { quote: 'q', author: 'a', title: 'x' } }), /no slot "title"/);
  assert.match(await failure({ layout: 'quote', slots: { quote: 'q' } }), /slot "author" has no value/);
  assert.match(await failure(content({ data: [['a']] })), /every row needs 2 cells/);
  assert.match(await failure(content({ title: ['one', 'two'] })), /takes a string or an object/);
  assert.match(await failure(content({ photo: 42 })), /slot "photo": type-mismatch/);
  const nullCell = await buildDesign(template, { pages: [content({ data: [['a', null]] })] });
  assert.equal(nullCell.design.pages[0].children.find((node) => node.type === 'table').cells[1].text, '');

  // Dotted names read nested data.
  const nested = await buildDesign({ schemaVersion: 5, pages: [page([text({ text: '{{user.city}}' })], { id: 'one' })] }, { pages: [{ layout: 'one', slots: { 'user.city': 'London' } }] });
  assert.deepEqual(nested.errors, []);
  assert.equal(nested.design.pages[0].children[0].text, 'London');

  // Template variables: a token that prints as written fails lint.
  const tokenDesign = (root) => ({ schemaVersion: 5, pages: [page([text({ text: 'Hi {{name}}' })])], ...root });
  const unfilled = run('lint.js', [write('unfilled.json', tokenDesign())]);
  assert.equal(unfilled.status, 1);
  assert.equal(rules(JSON.parse(unfilled.stdout).errors).has('variable-unfilled'), true);
  assert.equal(run('lint.js', [write('stored.json', tokenDesign({ variables: [{ name: 'name', value: 'Ada' }] }))]).status, 0);
  const lintVariables = (children, root) => lintPage(children, { variables: variablesApi }, {}, root);
  assert.equal(rules(lintVariables([text({ text: 'Hi {{name}}' })], { variables: [{ name: 'name', default: 'Ada' }] }).errors).has('variable-unfilled'), false);
  assert.equal(rules(lintVariables([table([cell('a', '{{price}}'), cell('b', 'B')])]).errors).has('variable-unfilled'), true);
  assert.equal(
    rules(lintVariables([figure({ bindings: { visible: 'show' } })], { variables: [{ name: 'show', value: 'yes' }] }).errors).has('variable-type-mismatch'),
    true
  );
  assert.equal(rules(lintVariables([text()], { variables: [{ name: 'unused' }] }).warnings).has('variable-orphan'), true);

  // A read-only install keeps working when the weekly check is due.
  if (process.getuid?.() !== 0) {
    const readOnly = fs.mkdtempSync(path.join(temporaryDirectory, 'read-only-'));
    fs.writeFileSync(path.join(readOnly, 'package.json'), JSON.stringify({ dependencies: {} }));
    fs.chmodSync(readOnly, 0o555);
    const environment = process.env.POLOTNO_DEPENDENCY_UPDATE;
    delete process.env.POLOTNO_DEPENDENCY_UPDATE;
    assert.equal(ensureDependencies({ directory: readOnly }), '{}');
    process.env.POLOTNO_DEPENDENCY_UPDATE = environment;
    fs.chmodSync(readOnly, 0o755);
  }

  assert.equal(discoveryFile('darwin', '/home/a').endsWith('Library/Application Support/polotno-app/mcp.json'), true);
  assert.equal(discoveryFile('linux', '/home/a'), '/home/a/.config/polotno-app/mcp.json');

  // lint.js lists the animation names by hand, so compare them with the SDK.
  // This is the check that a stale copy of the format would have needed.
  const { animations: sdkAnimations } = await import('polotno/utils/animations');
  const listed = new Set([...ANIMATION_NAMES.enter, ...ANIMATION_NAMES.loop]);
  assert.deepEqual([...listed].sort(), Object.keys(sdkAnimations).sort());
  const { CURRENT_SCHEMA_VERSION } = await import('@polotno/schema');
  const formatDoc = fs.readFileSync(path.join(__dirname, '../reference/design-format.md'), 'utf8');
  assert.equal(formatDoc.includes(`"schemaVersion": ${CURRENT_SCHEMA_VERSION},`), true);

  // The documented examples must stay valid, so each one runs here.
  const fenced = (file) =>
    [...fs.readFileSync(path.join(__dirname, '../reference', file), 'utf8').matchAll(/```json\n([\s\S]*?)```/g)]
      .map(([, body]) => body);
  const { validateDesign } = await import('@polotno/schema');
  const animationExample = fenced('animation.md').find((body) => body.includes('"pages"'));
  const exampleFile = write('animation-example.json', animationExample);
  assert.equal(run('validate.js', [exampleFile]).status, 0);
  const exampleLint = JSON.parse(run('lint.js', [exampleFile]).stdout);
  assert.deepEqual(exampleLint, { errors: [], warnings: [] });
  const tableExample = JSON.parse(fenced('data-content.md').find((body) => body.includes('"table"')));
  const tableDesign = { schemaVersion: CURRENT_SCHEMA_VERSION, width: 1920, height: 1080, pages: [page([tableExample])] };
  assert.equal(validateDesign(tableDesign, { mode: 'partial' }).valid, true);
  assert.deepEqual(lintDesign(tableDesign, ['Inter']).errors, []);
  const planExample = JSON.parse(fenced('templates-brand.md').find((body) => body.includes('"layout"')));
  assert.equal(planExample.pages.length, 3);

  if (process.env.POLOTNO_TEST_RENDER === '1') await renderSmokeTests();

  console.log('polotno-design script tests passed');
}

// Real exports through Chromium and the exporters. They need a browser and the
// network, so they run on request: POLOTNO_TEST_RENDER=1 npm test
async function renderSmokeTests() {
  process.env.POLOTNO_DEPENDENCY_UPDATE = 'auto';
  const fits = text({ id: 'fits', height: 100, width: 900 });
  const overflows = text({ id: 'overflows', text: 'Long text '.repeat(60), height: 60 });
  const design = {
    schemaVersion: 5,
    width: 1000,
    height: 600,
    fonts: [],
    audios: [],
    pages: [
      page([{ ...fits, animations: [animation('enter', 'fade', { duration: 300 })] }], { id: 'first', duration: 1000 }),
      page([overflows], { id: 'second', duration: 1000 })
    ]
  };
  const file = write('smoke.json', design);
  const out = (name) => path.join(temporaryDirectory, name);
  const render = (args) => {
    const result = run('render.js', [file, ...args]);
    assert.notEqual(result.status, 1, result.stderr);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };

  const images = render([out('p.png')]);
  assert.deepEqual(images.report.files, [out('p-1.png'), out('p-2.png')]);
  assert.deepEqual(images.report.overflow.map((item) => item.elementId), ['overflows']);
  assert.equal(render([out('strict.png'), '--strict']).status, 3);
  const firstOnly = render([out('one.png'), '--page', 'first', '--strict']);
  assert.equal(firstOnly.status, 0);
  assert.deepEqual(firstOnly.report.overflow, []);

  const pdfPages = (name) => (fs.readFileSync(out(name), 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.equal(render([out('all.pdf'), '--vector']).report.pages, 2);
  assert.equal(pdfPages('all.pdf'), 2);
  assert.equal(render([out('one.pdf'), '--vector', '--page', 'second']).report.pages, 1);
  assert.equal(pdfPages('one.pdf'), 1);

  const pptx = render([out('deck.pptx')]).report;
  assert.equal(pptx.slides.length, 2);
  assert.equal(pptx.slides[0].pictures, 0);

  // --page selects one page in every format, and a wrong id stops the run.
  assert.equal(render([out('page.pptx'), '--page', 'second']).report.slides.length, 1);
  assert.equal(render([out('page.gif'), '--page', 'second']).report.seconds, 1);
  assert.equal(render([out('page.mp4'), '--page', 'second']).report.seconds, 1);
  assert.equal(render([out('page-raster.pdf'), '--page', 'second']).report.pages, 1);
  assert.equal(pdfPages('page-raster.pdf'), 1);
  assert.equal(render([out('page-sheet.png'), '--sheet', '--page', 'second']).report.pages, 1);
  assert.equal(run('render.js', [file, out('none.pdf'), '--page', 'nope']).status, 1);
  assert.equal(fs.existsSync(out('none.pdf')), false);

  // A line cap in a tall box still reports its cut.
  const cappedFile = write('capped.json', {
    ...design,
    pages: [page([text({ id: 'capped', text: 'Long text '.repeat(60), height: 500, maxLines: 2 })])]
  });
  const cappedRun = run('render.js', [cappedFile, out('capped.png')]);
  assert.deepEqual(JSON.parse(cappedRun.stdout).overflow.map((item) => item.kind), ['text-cut']);

  // A local path can hold a parenthesis, in every exporter.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const logo = path.join(temporaryDirectory, 'logo (1).png');
  fs.writeFileSync(logo, png);
  const logoFile = write('logo.json', {
    ...design,
    pages: [page([{ id: 'logo', type: 'image', x: 0, y: 0, width: 9, height: 9, src: pathToFileURL(logo).href }])]
  });
  assert.equal(run('render.js', [logoFile, out('logo.pptx')]).status, 0);
  assert.equal(run('render.js', [logoFile, out('logo.pdf'), '--vector']).status, 0);

  for (const name of ['clip.mp4', 'clip.gif']) {
    assert.equal(render([out(name)]).report.seconds, 2);
    assert.equal(fs.statSync(out(name)).size > 1000, true);
  }
  assert.equal(render([out('frames.png'), '--frames', '1']).report.frames, 4);
  assert.equal(render([out('sheet.png'), '--sheet']).report.pages, 2);

  const localFile = write('local.json', { ...design, pages: [page([{ id: 'i', type: 'image', x: 0, y: 0, width: 9, height: 9, src: 'file:///no/such.png' }])] });
  const blocked = run('render.js', [localFile, out('blocked.png')], { POLOTNO_UNTRUSTED: '1' });
  assert.equal(blocked.status, 1);
  assert.equal(JSON.parse(blocked.stderr.slice(blocked.stderr.indexOf('{'))).error.code, 'DESIGN_INVALID');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
