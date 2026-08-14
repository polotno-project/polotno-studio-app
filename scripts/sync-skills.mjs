// Vendors the polotno-design skill from the polotno-project/skills repo at a
// pinned commit into vendor/skills/. The vendored copy is committed; bump
// SKILL_COMMIT deliberately and re-run:
//   node scripts/sync-skills.mjs [path-to-skills-repo]
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_COMMIT = '3e872591e3aeee0ec253e1f679f18f9e84d9ebb8'
const SKILL_PATH = 'skills/polotno-design'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_REPO = process.argv[2] ?? path.resolve(ROOT, '../polotno-skills')
const DEST = path.join(ROOT, 'vendor/skills/polotno-design')

const tarball = execFileSync('git', ['-C', SOURCE_REPO, 'archive', SKILL_COMMIT, SKILL_PATH], {
  maxBuffer: 64 * 1024 * 1024
})

await fs.rm(DEST, { recursive: true, force: true })
await fs.mkdir(DEST, { recursive: true })
const tmp = path.join(ROOT, 'vendor/.skill-sync.tar')
await fs.writeFile(tmp, tarball)
execFileSync('tar', ['-x', '-f', tmp, '-C', path.join(ROOT, 'vendor/skills/polotno-design'), '--strip-components', '2'])
await fs.rm(tmp)
await fs.writeFile(
  path.join(DEST, '.pin'),
  `${SKILL_COMMIT} ${SKILL_PATH} from polotno-project/skills\n`
)
console.log(`vendored ${SKILL_PATH}@${SKILL_COMMIT.slice(0, 7)} -> vendor/skills/polotno-design`)
