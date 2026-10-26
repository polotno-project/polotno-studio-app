// Run: node --test scripts/polotno-patch-release.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addChangelogEntry,
  nextPatch,
  polotnoChanges,
  polotnoVersions
} from './polotno-patch-release.mjs'

const lockOf = (versions) => ({
  packages: Object.fromEntries(
    Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])
  )
})

test('polotnoVersions reads installed versions of direct Polotno deps', () => {
  const pkg = {
    dependencies: { react: '^19.0.0' },
    devDependencies: { polotno: '^4.16.1', '@polotno/schema': '^0.7.0' }
  }
  // Lockfile-only bump: the range still says ^4.16.1. Transitive @polotno/core
  // isn't in package.json and stays out.
  const lock = lockOf({
    polotno: '4.18.0',
    '@polotno/schema': '0.9.1',
    '@polotno/core': '0.18.0',
    react: '19.2.0'
  })
  assert.deepEqual(polotnoVersions(pkg, lock), { polotno: '4.18.0', '@polotno/schema': '0.9.1' })
})

test('polotnoVersions fails on a package missing from the lockfile', () => {
  assert.throws(
    () => polotnoVersions({ devDependencies: { polotno: '^4.16.1' } }, lockOf({})),
    /polotno is in package.json but not in package-lock.json/
  )
})

test('polotnoChanges lists bumped, added and removed packages', () => {
  const before = { polotno: '4.16.1', '@polotno/schema': '0.7.0', '@polotno/pdf-import': '0.9.0' }
  const after = { polotno: '4.18.0', '@polotno/schema': '0.7.0', '@polotno/svg-import': '0.2.3' }
  assert.deepEqual(polotnoChanges(before, after), [
    { name: 'polotno', from: '4.16.1', to: '4.18.0' },
    { name: '@polotno/svg-import', from: undefined, to: '0.2.3' },
    { name: '@polotno/pdf-import', from: '0.9.0', to: undefined }
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
    { name: 'polotno', from: '4.16.1', to: '4.18.0' },
    { name: '@polotno/svg-import', from: undefined, to: '0.2.3' },
    { name: '@polotno/pdf-import', from: '0.9.0', to: undefined }
  ]
  assert.equal(
    addChangelogEntry(changelog, '0.3.1', '2026-10-26', changes),
    '# Changelog\n\nIntro.\n\n## 0.3.1 — 2026-10-26\n\n### Changed\n\n' +
      '- Polotno SDK update: `polotno` 4.18.0 (from 4.16.1), `@polotno/svg-import` 0.2.3, ' +
      '`@polotno/pdf-import` removed.\n\n' +
      '## 0.3.0 — 2026-10-22\n\n- Old.\n'
  )
})
