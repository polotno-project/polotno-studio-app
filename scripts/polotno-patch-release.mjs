// Prepares a patch release after Dependabot bumps polotno / @polotno/*
// (.github/workflows/polotno-release.yml). Compares the Polotno packages in
// package.json with the last release tag (v<current version>); when they
// changed, adds a CHANGELOG entry for the next patch version and prints that
// version. Prints nothing when there is nothing to release.
// Run: node scripts/polotno-patch-release.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isPolotno = (name) => name === 'polotno' || name.startsWith('@polotno/')
const bare = (range) => range.replace(/^[\^~]/, '')

function polotnoDeps(pkg) {
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  return Object.fromEntries(Object.entries(all).filter(([name]) => isPolotno(name)))
}

export function polotnoChanges(oldPkg, newPkg) {
  const before = polotnoDeps(oldPkg)
  return Object.entries(polotnoDeps(newPkg))
    .filter(([name, range]) => before[name] !== range)
    .map(([name, range]) => ({
      name,
      from: before[name] && bare(before[name]),
      to: bare(range)
    }))
}

export function nextPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

export function addChangelogEntry(changelog, version, date, changes) {
  const list = changes
    .map(({ name, from, to }) => `\`${name}\` ${to}${from ? ` (from ${from})` : ''}`)
    .join(', ')
  const entry = `## ${version} — ${date}\n\n### Changed\n\n- Polotno SDK update: ${list}.\n\n`
  const at = changelog.indexOf('\n## ')
  if (at === -1) return `${changelog.trimEnd()}\n\n${entry}`
  return changelog.slice(0, at + 1) + entry + changelog.slice(at + 1)
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const released = JSON.parse(
    execFileSync('git', ['show', `v${pkg.version}:package.json`], { encoding: 'utf8' })
  )
  const changes = polotnoChanges(released, pkg)
  if (changes.length === 0) return
  const version = nextPatch(pkg.version)
  const date = new Date().toISOString().slice(0, 10)
  writeFileSync(
    'CHANGELOG.md',
    addChangelogEntry(readFileSync('CHANGELOG.md', 'utf8'), version, date, changes)
  )
  console.log(version)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
