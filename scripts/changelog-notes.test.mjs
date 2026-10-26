// Run: node --test scripts/changelog-notes.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changelogSection } from './changelog-notes.mjs'

const changelog = [
  '# Changelog',
  '',
  'Intro.',
  '',
  '## 0.3.1 — 2026-10-26',
  '',
  '### Changed',
  '',
  '- Polotno SDK update.',
  '',
  '## 0.3.0 — 2026-10-22',
  '',
  '- Old.',
  ''
].join('\n')

test('changelogSection returns one version without its heading', () => {
  assert.equal(changelogSection(changelog, '0.3.1'), '### Changed\n\n- Polotno SDK update.')
  assert.equal(changelogSection(changelog, '0.3.0'), '- Old.')
})

test('changelogSection is empty for an unknown version', () => {
  assert.equal(changelogSection(changelog, '0.3'), '')
  assert.equal(changelogSection(changelog, '9.9.9'), '')
})
