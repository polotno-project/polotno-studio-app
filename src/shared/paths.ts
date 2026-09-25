// Windows paths are case-insensitive and accept both separators, so one file
// can arrive spelled several ways (Explorer, the open dialog, a CLI argument).
// Compare paths through this key, never with ===.
export function pathKey(filePath: string, platform: string): string {
  return platform === 'win32' ? filePath.replace(/\//g, '\\').toLowerCase() : filePath
}

export function samePath(a: string, b: string, platform: string): boolean {
  return pathKey(a, platform) === pathKey(b, platform)
}
