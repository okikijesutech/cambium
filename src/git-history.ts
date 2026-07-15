import { execSync } from "child_process";
import * as path from "path";

/**
 * Touch frequency: how many commits touched a given file. A file
 * touched across many unrelated commits is a different kind of drift
 * signal than complexity or fan-in — it can catch a file that keeps
 * absorbing changes for features that don't really belong to it,
 * even if its current complexity score looks moderate.
 *
 * Returns a Map keyed by absolute, forward-slash-normalized file path
 * (matching the format ts-morph/scan-repo already use), so results
 * can be merged directly against RepoFileMetrics.filePath.
 *
 * Returns null if the path isn't a git repo (not an error — just
 * means this signal isn't available, caller should degrade gracefully).
 */
/**
 * Git Bash (MINGW64) on Windows often returns POSIX-style paths from
 * `git rev-parse --show-toplevel` — e.g. /c/Users/HP/desktop/pwmngerTS
 * instead of C:/Users/HP/desktop/pwmngerTS. Node's path module on
 * Windows doesn't understand that format and silently produces wrong
 * absolute paths when resolving against it (no error — just paths
 * that never match anything, which is worse than crashing). Detect
 * and convert this specific pattern before using the path.
 */
function normalizeGitBashPath(p: string): string {
  const match = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (match) {
    return `${match[1].toUpperCase()}:/${match[2]}`;
  }
  return p;
}

export function getTouchFrequency(repoPath: string): Map<string, number> | null {
  let gitRoot: string;
  try {
    const rawRoot = execSync("git rev-parse --show-toplevel", {
      cwd: repoPath,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    gitRoot = normalizeGitBashPath(rawRoot);
  } catch {
    return null; // not a git repo, or git isn't installed
  }

  let output: string;
  try {
    output = execSync("git log --name-only --pretty=format:", {
      cwd: repoPath,
      maxBuffer: 1024 * 1024 * 50, // 50MB — large repos can have long histories
      encoding: "utf-8",
    });
  } catch {
    return null; // e.g. repo with zero commits
  }

  const counts = new Map<string, number>();
  const lines = output.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!/\.(ts|tsx)$/.test(line)) continue;
    if (line.includes("node_modules/")) continue;

    // git log paths are always relative to the repo ROOT (from
    // `git rev-parse --show-toplevel`), not to whatever subdirectory
    // was passed in as repoPath — resolving against repoPath directly
    // silently breaks whenever repoPath is a subdirectory of the repo.
    const absolute = path.resolve(gitRoot, line).replace(/\\/g, "/");
    counts.set(absolute, (counts.get(absolute) ?? 0) + 1);
  }

  return counts;
}
