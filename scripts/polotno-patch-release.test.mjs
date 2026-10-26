// Run: node --test scripts/polotno-patch-release.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addChangelogEntry, nextPatch, polotnoChanges } from './polotno-patch-release.mjs'

test('polotnoChanges lists only changed Polotno packages', () => {
  const before = {
    dependencies: { react: '^19.0.0' },
    devDependencies: { polotno: '^4.16.1', '@polotno/schema': '^0.7.0', vite: '^7.0.0' }
  }
  const after = {
    dependencies: { react: '^19.2.0' },
    devDependencies: {
      polotno: '^4.17.0',
      '@polotno/schema': '^0.7.0',
      '@polotno/svg-import': '^0.2.2',
      vite: '^7.2.0'
    }
  }
  assert.deepEqual(polotnoChanges(before, after), [
    { name: 'polotno', from: '4.16.1', to: '4.17.0' },
    { name: '@polotno/svg-import', from: undefined, to: '0.2.2' }
  ])
  assert.deepEqual(polotnoChanges(before, before), [])
})

test('nextPatch bumps the patch number', () => {
  assert.equal(nextPatch('0.3.0'), '0.3.1')
  assert.equal(nextPatch('1.9.9'), '1.9.10')
})

test('addChangelogEntry puts the entry above the latest release', () => {
  const changelog = '# Changelog\n\nIntro.\n\n## 0.3.0 — 2026-10-22\n\n- Old.\n'
  const changes = [
    { name: 'polotno', from: '4.16.1', to: '4.17.0' },
    { name: '@polotno/svg-import', from: undefined, to: '0.2.2' }
  ]
  assert.equal(
    addChangelogEntry(changelog, '0.3.1', '2026-10-26', changes),
    '# Changelog\n\nIntro.\n\n## 0.3.1 — 2026-10-26\n\n### Changed\n\n' +
      '- Polotno SDK update: `polotno` 4.17.0 (from 4.16.1), `@polotno/svg-import` 0.2.2.\n\n' +
      '## 0.3.0 — 2026-10-22\n\n- Old.\n'
  )
})
