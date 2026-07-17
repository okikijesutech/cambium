/**
 * Windows filesystems (NTFS) are case-insensitive, but JS Map/string
 * comparisons are not. git's toplevel path and ts-morph's resolved
 * absolute paths can end up differently-cased depending on how the
 * user typed the path on the command line, causing every lookup to
 * silently miss on Windows even though the paths refer to the same
 * file. Normalize case for matching purposes only, on Windows.
 */
export function normalizePathKey(p: string): string {
  return process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * Git Bash (MINGW64) on Windows often returns POSIX-style paths from
 * `git rev-parse --show-toplevel` — e.g. /c/Users/HP/desktop/pwmngerTS
 * instead of C:/Users/HP/desktop/pwmngerTS. Node's path module on
 * Windows doesn't understand that format and silently produces wrong
 * absolute paths when resolving against it (no error — just paths
 * that never match anything, which is worse than crashing). Detect
 * and convert this specific pattern before using the path.
 */
export function normalizeGitBashPath(p: string): string {
  const match = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (match) {
    return `${match[1].toUpperCase()}:/${match[2]}`;
  }
  return p;
}
