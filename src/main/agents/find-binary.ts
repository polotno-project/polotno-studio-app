import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio
} from 'node:child_process'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

const isWindows = process.platform === 'win32'

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fsConstants.X_OK)
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

// GUI apps on macOS don't inherit the shell PATH, so ask the user's login
// shell where the command is.
function fromLoginShell(command: string): Promise<string | null> {
  if (isWindows) return Promise.resolve(null)
  const shellPath = process.env.SHELL || '/bin/zsh'
  return new Promise((resolve) => {
    execFile(shellPath, ['-ilc', `command -v ${command}`], { timeout: 5000 }, (error, stdout) => {
      const line = stdout.trim().split('\n').pop()?.trim()
      resolve(!error && line?.startsWith('/') ? line : null)
    })
  })
}

// On Windows a command is a file with one of PATHEXT's extensions: claude.exe
// from the native installer, codex.cmd from npm.
function withExtensions(path: string): string[] {
  if (!isWindows) return [path]
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  return extensions.map((extension) => path + extension.toLowerCase())
}

// Where the user installed an agent's CLI: an override from the environment,
// the login shell's PATH, ours, then the usual install locations.
export async function findBinary(
  command: string,
  { envOverride, extra = [] }: { envOverride: string; extra?: string[] }
): Promise<string | null> {
  const home = homedir()
  const candidates = [
    process.env[envOverride],
    await fromLoginShell(command),
    ...(process.env.PATH ?? '')
      .split(delimiter)
      .filter(Boolean)
      .flatMap((dir) => withExtensions(join(dir, command))),
    ...(isWindows
      ? [
          ...withExtensions(join(home, '.local', 'bin', command)),
          ...(process.env.APPDATA ? withExtensions(join(process.env.APPDATA, 'npm', command)) : [])
        ]
      : [
          `/opt/homebrew/bin/${command}`,
          `/usr/local/bin/${command}`,
          join(home, '.local/bin', command),
          join(home, '.npm-global/bin', command)
        ]),
    ...extra
  ]
  for (const candidate of candidates) {
    if (candidate && (await isExecutable(candidate))) return candidate
  }
  return null
}

// npm's Windows shims (.cmd, .bat) are batch files, which Node no longer
// starts without a shell. They run through cmd.exe instead; arguments passed
// this way must be plain words (no quotes, carets, percent signs).
export function isBatchFile(path: string): boolean {
  return isWindows && /\.(cmd|bat)$/i.test(path)
}

function command(binary: string, args: string[]): [string, string[]] {
  return isBatchFile(binary)
    ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${binary}"`, ...args]]
    : [binary, args]
}

export function spawnBinary(
  binary: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  const [file, fileArgs] = command(binary, args)
  return spawn(file, fileArgs, { ...options, windowsVerbatimArguments: isBatchFile(binary) })
}

// Runs the CLI and returns its stdout even when it exits non-zero (`claude
// auth status` exits 1 when signed out).
export function runBinary(
  binary: string,
  args: string[],
  { env, timeout = 15000 }: { env?: NodeJS.ProcessEnv; timeout?: number } = {}
): Promise<string> {
  const [file, fileArgs] = command(binary, args)
  return new Promise((resolve, reject) => {
    execFile(
      file,
      fileArgs,
      { env, timeout, windowsVerbatimArguments: isBatchFile(binary) },
      (error, stdout) => {
        if (stdout) resolve(stdout)
        else reject(error ?? new Error(`${binary} ${args.join(' ')} printed nothing`))
      }
    )
  })
}

// Settings a user may export only in their shell profile (which a GUI app
// started from the Dock or Finder never reads). Read once from the login
// shell; a value the app itself was started with wins.
let shellEnv: Promise<NodeJS.ProcessEnv> | null = null

export function loginShellEnv(names: string[]): Promise<NodeJS.ProcessEnv> {
  shellEnv ??= new Promise((resolve) => {
    if (isWindows) return resolve({})
    const shellPath = process.env.SHELL || '/bin/zsh'
    const marker = '__polotno_env__'
    // The marker skips whatever the profile itself prints.
    execFile(
      shellPath,
      ['-ilc', `printf '%s\\n' ${marker}; /usr/bin/env`],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) return resolve({})
        const env: NodeJS.ProcessEnv = {}
        for (const line of stdout.split(marker).pop()!.split('\n')) {
          const at = line.indexOf('=')
          if (at > 0) env[line.slice(0, at)] = line.slice(at + 1)
        }
        resolve(env)
      }
    )
  })
  return shellEnv.then((env) =>
    Object.fromEntries(
      names.filter((name) => !process.env[name] && env[name]).map((name) => [name, env[name]])
    )
  )
}
