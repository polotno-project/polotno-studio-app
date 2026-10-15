import { execFile } from 'node:child_process'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

// GUI apps on macOS don't inherit the shell PATH, so ask the user's login
// shell where the command is.
function fromLoginShell(command: string): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null)
  const shellPath = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shellPath, ['-ilc', `command -v ${command}`], { timeout: 5000 }, (error, stdout) => {
      const line = stdout.trim().split('\n').pop()?.trim()
      resolve(!error && line?.startsWith('/') ? line : null)
    })
  })
}

// Where the user installed an agent's CLI: an override from the environment,
// the login shell's PATH, ours, then the usual install locations.
export async function findBinary(
  command: string,
  { envOverride, extra = [] }: { envOverride: string; extra?: string[] }
): Promise<string | null> {
  const candidates = [
    process.env[envOverride],
    await fromLoginShell(command),
    ...(process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, command)),
    `/opt/homebrew/bin/${command}`,
    `/usr/local/bin/${command}`,
    join(homedir(), '.local/bin', command),
    join(homedir(), '.npm-global/bin', command),
    ...extra
  ]
  for (const candidate of candidates) {
    if (candidate && (await isExecutable(candidate))) return candidate
  }
  return null
}
