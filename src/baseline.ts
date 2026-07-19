import * as fs from "fs";
import * as path from "path";
import { ScoredFileMetrics } from "./scoring";

const BASELINE_DIR = ".cambium";
const BASELINE_FILE = "baseline.json";

interface BaselineFileEntry {
  lines: number;
  cyclomaticComplexity: number;
  fanIn: number;
  exportCount: number;
  touchCount: number | null;
}

export interface Baseline {
  createdAt: string;
  cambiumVersion: string;
  // Keyed by path RELATIVE to repo root, not absolute — this is what
  // makes a baseline portable across machines and committable to git
  // for a whole team to share. An absolute path (C:/Users/HP/...)
  // would only ever match the exact machine that created it.
  files: Record<string, BaselineFileEntry>;
}

export interface FileDelta {
  linesDelta: number;
  complexityDelta: number;
  fanInDelta: number;
  isNew: boolean; // file didn't exist in the baseline at all
}

function getBaselinePath(repoRoot: string): string {
  return path.join(repoRoot, BASELINE_DIR, BASELINE_FILE);
}

export function baselineExists(repoRoot: string): boolean {
  return fs.existsSync(getBaselinePath(repoRoot));
}

/**
 * Convert an absolute file path (what scanRepo/ScoredFileMetrics use)
 * to a path relative to repoRoot, with forward slashes, so it matches
 * regardless of OS or where the repo happens to be cloned.
 */
function toRelativeKey(absolutePath: string, repoRoot: string): string {
  const absRoot = path.resolve(repoRoot).replace(/\\/g, "/");
  const absFile = absolutePath.replace(/\\/g, "/");
  return absFile.startsWith(absRoot)
    ? absFile.slice(absRoot.length).replace(/^\//, "")
    : absFile;
}

export function saveBaseline(
  repoRoot: string,
  results: ScoredFileMetrics[],
  cambiumVersion: string
): void {
  const files: Record<string, BaselineFileEntry> = {};

  for (const m of results) {
    const key = toRelativeKey(m.filePath, repoRoot);
    files[key] = {
      lines: m.lines,
      cyclomaticComplexity: m.cyclomaticComplexity,
      fanIn: m.fanIn,
      exportCount: m.exportedSymbols.length,
      touchCount: m.touchCount,
    };
  }

  const baseline: Baseline = {
    createdAt: new Date().toISOString(),
    cambiumVersion,
    files,
  };

  const dir = path.join(repoRoot, BASELINE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getBaselinePath(repoRoot), JSON.stringify(baseline, null, 2), "utf-8");
}

export function loadBaseline(repoRoot: string): Baseline | null {
  const p = getBaselinePath(repoRoot);
  if (!fs.existsSync(p)) return null;

  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as Baseline;
  } catch (err) {
    // A corrupted/hand-edited baseline file should degrade gracefully,
    // not crash every scan from here on — same principle as the git
    // history handling: missing signal is fine, silently wrong data
    // is not.
    console.error(
      `⚠ Could not read baseline at ${p} (${(err as Error).message}) — ` +
        `ignoring it for this run. Run 'cambium baseline' again to regenerate it.`
    );
    return null;
  }
}

/**
 * Compute how a file has changed since the baseline was taken. Returns
 * null if the file isn't in the baseline at all (baseline predates it,
 * or it was outside the scanned scope) — that's a real, meaningful
 * case ("this file is new since baseline") that callers should show
 * distinctly, not silently treat as zero change.
 */
export function computeDelta(
  current: ScoredFileMetrics,
  baseline: Baseline,
  repoRoot: string
): FileDelta {
  const key = toRelativeKey(current.filePath, repoRoot);
  const entry = baseline.files[key];

  if (!entry) {
    return { linesDelta: 0, complexityDelta: 0, fanInDelta: 0, isNew: true };
  }

  return {
    linesDelta: current.lines - entry.lines,
    complexityDelta: current.cyclomaticComplexity - entry.cyclomaticComplexity,
    fanInDelta: current.fanIn - entry.fanIn,
    isNew: false,
  };
}
