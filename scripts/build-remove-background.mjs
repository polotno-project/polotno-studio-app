// Builds the macOS background-removal helper (native/remove-background) into
// out/helpers/remove-background: a universal binary (arm64 + x86_64) for
// macOS 14+, the first release with the Vision API it uses.
// electron-builder ships it in the mac app only (mac.extraResources), and
// signs it with the app (hardened runtime, entitlementsInherit). On other
// platforms this is a no-op, so Windows and Linux builders need no Xcode.
// Skips the compile when the binary is newer than its source.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  console.log('remove-background helper: macOS only, skipped')
  process.exit(0)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'native/remove-background/main.swift')
const output = join(root, 'out/helpers/remove-background')

const built = statSync(output, { throwIfNoEntry: false })?.mtimeMs ?? 0
const inputs = [source, fileURLToPath(import.meta.url)].map((path) => statSync(path).mtimeMs)
if (built > Math.max(...inputs)) {
  console.log('remove-background helper: up to date')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'remove-background-'))
try {
  const slices = ['arm64', 'x86_64'].map((arch) => {
    const slice = join(work, arch)
    execFileSync(
      'xcrun',
      ['swiftc', '-O', '-target', `${arch}-apple-macos14`, '-o', slice, source],
      { stdio: 'inherit' }
    )
    return slice
  })
  mkdirSync(dirname(output), { recursive: true })
  execFileSync('lipo', ['-create', ...slices, '-output', output], { stdio: 'inherit' })
  console.log(`remove-background helper: built ${output}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
