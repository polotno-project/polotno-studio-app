// Prints the CHANGELOG.md section of one version, without its heading: the
// body for a GitHub release that has none yet (.github/workflows/release.yml).
// Run: node scripts/changelog-notes.mjs 0.3.1
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function changelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`## ${version} `))
  if (start === -1) return ''
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join('\n')
    .trim()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const notes = changelogSection(readFileSync('CHANGELOG.md', 'utf8'), process.argv[2])
  if (notes) console.log(notes)
}
