import * as fs from "fs";
import * as path from "path";
import { toForwardSlashes } from "./git-paths";

/**
 * Checks if a file's source code contains an inline `@cambium-ignore` pragma,
 * e.g. `// @cambium-ignore`, `/* @cambium-ignore *\/`, or ` * @cambium-ignore`.
 */
export function isIgnoredByPragma(sourceText: string): boolean {
  return /(?:^|\n)\s*(?:\/\/|\/\*|\*)\s*@cambium-ignore\b/i.test(sourceText);
}

/**
 * Loads ignore patterns from a `.cambiumignore` file in repo root if it exists.
 * Returns an array of trimmed, non-comment pattern lines.
 */
export function loadCambiumIgnore(repoRoot: string): string[] {
  const ignoreFilePath = path.join(repoRoot, ".cambiumignore");
  if (!fs.existsSync(ignoreFilePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(ignoreFilePath, "utf-8");
    return parseIgnoreContent(content);
  } catch (err) {
    console.error(`⚠ Could not read .cambiumignore at ${ignoreFilePath}: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Parses raw .cambiumignore text into a list of pattern strings.
 * Discards empty lines and lines starting with `#`.
 */
export function parseIgnoreContent(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Converts a glob pattern into a RegExp.
 * Supports:
 * - `**` (recursive directory match)
 * - `*` (match within directory)
 * - `?` (single character)
 * - trailing `/` (matches entire directory contents)
 * - bare filenames e.g. `schema.ts` or `*.fixture.ts` (matches anywhere)
 */
export function globPatternToRegex(pattern: string): RegExp {
  let p = toForwardSlashes(pattern.trim());

  // Trailing slash means match directory and all its contents
  if (p.endsWith("/")) {
    p = `${p}**`;
  }

  // Remove leading './' if present
  if (p.startsWith("./")) {
    p = p.slice(2);
  }

  // If pattern does not contain a slash, match anywhere in directory tree
  if (!p.includes("/")) {
    p = `**/${p}`;
  }

  // Use unique placeholders for glob wildcards before escaping regex special chars
  const DOUBLE_STAR = "___DBLSTAR___";
  const SINGLE_STAR = "___SGLSTAR___";
  const QUESTION = "___QMARK___";

  const placeholderString = p
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, SINGLE_STAR)
    .replace(/\?/g, QUESTION);

  const escaped = placeholderString.replace(/[.+^${}()|[\]\\]/g, "\\$&");

  const regexString = escaped
    .replace(new RegExp(`${DOUBLE_STAR}/`, "g"), "(?:.+/)?")
    .replace(new RegExp(`/${DOUBLE_STAR}`, "g"), "(?:/.*)?")
    .replace(new RegExp(DOUBLE_STAR, "g"), ".*")
    .replace(new RegExp(SINGLE_STAR, "g"), "[^/]*")
    .replace(new RegExp(QUESTION, "g"), "[^/]");

  return new RegExp(`^(?:${regexString})$`, "i");
}

export interface IgnoreMatcher {
  (filePath: string): boolean;
  patterns: string[];
}

/**
 * Creates a matcher function from an array of glob ignore patterns.
 * Given a file path (either absolute or relative), returns true if any pattern matches.
 */
export function createIgnoreMatcher(patterns: string[], repoRoot?: string): IgnoreMatcher {
  const activePatterns = patterns.filter((p) => p.trim().length > 0);
  const regexes = activePatterns.map((p) => globPatternToRegex(p));
  const resolvedRepo = repoRoot ? toForwardSlashes(path.resolve(repoRoot)) : null;

  const matcher = ((filePath: string): boolean => {
    let normalized = toForwardSlashes(filePath);

    // If repoRoot is provided, make filePath relative to it
    if (resolvedRepo) {
      const resolvedFile = toForwardSlashes(path.resolve(filePath));
      if (resolvedFile.startsWith(resolvedRepo)) {
        normalized = resolvedFile.slice(resolvedRepo.length).replace(/^\//, "");
      }
    }

    // Match against each regex
    for (const regex of regexes) {
      if (regex.test(normalized)) {
        return true;
      }
    }

    return false;
  }) as IgnoreMatcher;

  matcher.patterns = activePatterns;
  return matcher;
}
