// Prepares a patch release when polotno / @polotno/* changed since the last
// release (.github/workflows/polotno-release.yml). Compares the installed
// versions in package-lock.json with the ones at the last release tag
// (v<current version>): Dependabot sometimes bumps only the lockfile. When
// they differ, adds a CHANGELOG entry for the next patch version and prints
// that version. Prints nothing when there is nothing to release.
// Run: node scripts/polotno-patch-release.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isPolotno = (name) => name === 'polotno' || name.startsWith('@polotno/')

// Installed versions of the Polotno packages package.json depends on directly.
export function polotnoVersions(pkg, lock) {
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(isPolotno)
  return Object.fromEntries(
    names.map((name) => {
      const version = lock.packages?.[`node_modules/${name}`]?.version
      if (!version) throw new Error(`${name} is in package.json but not in package-lock.json`)
      return [name, version]
    })
  )
}

export function polotnoChanges(before, after) {
  const names = [...new Set([...Object.keys(after), ...Object.keys(before)])]
  return names
    .filter((name) => before[name] !== after[name])
    .map((name) => ({ name, from: before[name], to: after[name] }))
}

export function nextPatch(version) {
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

function describe({ name, from, to }) {
  if (!to) return `\`${name}\` removed`
  return `\`${name}\` ${to}${from ? ` (from ${from})` : ''}`
}

export function addChangelogEntry(changelog, version, date, changes) {
  const list = changes.map(describe).join(', ')
  const entry = `## ${version} — ${date}\n\n### Changed\n\n- Polotno SDK update: ${list}.\n\n`
  const at = changelog.indexOf('\n## ')
  if (at === -1) return `${changelog.trimEnd()}\n\n${entry}`
  return changelog.slice(0, at + 1) + entry + changelog.slice(at + 1)
}

function readAt(tag, file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${tag}:${file}`], { encoding: 'utf8' }))
  } catch (err) {
    throw new Error(`Can't read ${file} at ${tag} (is the tag fetched?)`, { cause: err })
  }
}

function main() {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const tag = `v${pkg.version}`
  const changes = polotnoChanges(
    polotnoVersions(readAt(tag, 'package.json'), readAt(tag, 'package-lock.json')),
    polotnoVersions(pkg, lock)
  )
  if (changes.length === 0) return
  const version = nextPatch(pkg.version)
  const date = new Date().toISOString().slice(0, 10)
  writeFileSync(
    'CHANGELOG.md',
    addChangelogEntry(readFileSync('CHANGELOG.md', 'utf8'), version, date, changes)
  )
  console.log(version)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
