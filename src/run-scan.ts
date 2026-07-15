import { scanRepo, RepoFileMetrics } from "./scan-repo";

const repoRoot = process.argv[2];

if (!repoRoot) {
  console.error("Usage: ts-node src/run-scan.ts <path-to-repo-root>");
  process.exit(1);
}

console.error(`Scanning ${repoRoot} ...`);
const results = scanRepo(repoRoot);
console.error(`Found ${results.length} files.`);

// Simple composite outlier score: weight complexity highest, since
// that's the sharpest signal so far, then lines, then inverse fan-in
// concern (a file with high complexity AND high fan-in is worse —
// lots of things depend on a module that's already sprawling).
function outlierScore(m: RepoFileMetrics): number {
  return m.cyclomaticComplexity * 2 + m.lines * 0.1 + m.fanIn * 3;
}

const sorted = [...results].sort(
  (a, b) => outlierScore(b) - outlierScore(a)
);

const top = sorted.slice(0, 25).map((m) => ({
  filePath: m.filePath,
  lines: m.lines,
  cyclomaticComplexity: m.cyclomaticComplexity,
  fanIn: m.fanIn,
  exportedSymbols: m.exportedSymbols.length,
  outlierScore: Math.round(outlierScore(m) * 10) / 10,
}));

console.log(JSON.stringify(top, null, 2));
