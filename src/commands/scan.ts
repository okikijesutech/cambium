import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { scanRepo } from "../scan-repo";
import { getTouchFrequency } from "../git-history";
import { attachTouchFrequency, computeOutlierScore, ScoredFileMetrics } from "../scoring";
import { formatScanReportMarkdown } from "../report";
import { loadBaseline, computeDelta, Baseline } from "../baseline";
import { isTestFile } from "../test-file-detection";
import { toForwardSlashes } from "../git-paths";

function formatDelta(n: number): string {
  if (n === 0) return "±0";
  return n > 0 ? `+${n}` : `${n}`;
}

export interface ScanJsonOutlier {
  filePath: string;
  relativeFilePath: string;
  score: number;
  cyclomaticComplexity: number;
  lines: number;
  fanIn: number;
  touches: number | null;
  exports: number;
  exportedSymbols: string[];
  hasSyntaxErrors: boolean;
  delta: {
    isNew: boolean;
    complexityDelta: number;
    linesDelta: number;
  } | null;
}

export interface ScanJsonReport {
  repoPath: string;
  scannedFiles: number;
  outliersCount: number;
  limit: number;
  hasGitHistory: boolean;
  hasSyntaxErrors: boolean;
  syntaxErrorsCount: number;
  baseline: {
    createdAt: string;
    fileCount: number;
  } | null;
  outliers: ScanJsonOutlier[];
}

export function buildScanJsonReport(
  results: ScoredFileMetrics[],
  limit: number,
  repoPath: string,
  baseline: Baseline | null
): ScanJsonReport {
  const sorted = [...results].sort(
    (a, b) => computeOutlierScore(b) - computeOutlierScore(a)
  );
  const top = sorted.slice(0, limit);
  const hasTouchData = results.some((m) => m.touchCount != null);
  const syntaxErrorsCount = results.filter((m) => m.hasSyntaxErrors).length;
  const resolvedRepo = path.resolve(repoPath);

  const outliers: ScanJsonOutlier[] = top.map((m) => {
    const resolvedFile = path.resolve(m.filePath);
    let rel = toForwardSlashes(path.relative(resolvedRepo, resolvedFile));
    if (!rel || rel.startsWith("../")) {
      rel = toForwardSlashes(m.filePath);
    }

    let delta: { isNew: boolean; complexityDelta: number; linesDelta: number } | null = null;
    if (baseline) {
      const d = computeDelta(m, baseline, repoPath);
      delta = {
        isNew: d.isNew,
        complexityDelta: d.complexityDelta,
        linesDelta: d.linesDelta,
      };
    }

    return {
      filePath: toForwardSlashes(m.filePath),
      relativeFilePath: rel,
      score: Math.round(computeOutlierScore(m) * 10) / 10,
      cyclomaticComplexity: m.cyclomaticComplexity,
      lines: m.lines,
      fanIn: m.fanIn,
      touches: m.touchCount ?? null,
      exports: m.exportedSymbols.length,
      exportedSymbols: m.exportedSymbols,
      hasSyntaxErrors: m.hasSyntaxErrors,
      delta,
    };
  });

  return {
    repoPath: toForwardSlashes(resolvedRepo),
    scannedFiles: results.length,
    outliersCount: top.length,
    limit,
    hasGitHistory: hasTouchData,
    hasSyntaxErrors: syntaxErrorsCount > 0,
    syntaxErrorsCount,
    baseline: baseline
      ? {
          createdAt: baseline.createdAt,
          fileCount: Object.keys(baseline.files).length,
        }
      : null,
    outliers,
  };
}

function printOutlierTable(
  results: ScoredFileMetrics[],
  limit: number,
  repoPath: string,
  baseline: Baseline | null
) {
  const sorted = [...results].sort(
    (a, b) => computeOutlierScore(b) - computeOutlierScore(a)
  );
  const top = sorted.slice(0, limit);
  const hasTouchData = results.some((m) => m.touchCount != null);
  const resolvedRepo = path.resolve(repoPath);

  console.log(
    `\nTop ${top.length} outlier(s) of ${results.length} file(s) scanned:\n`
  );

  for (const m of top) {
    const resolvedFile = path.resolve(m.filePath);
    const rel = toForwardSlashes(path.relative(resolvedRepo, resolvedFile));
    const displayPath = (!rel || rel.startsWith("../")) ? m.filePath.split(/[\\/]/).slice(-3).join("/") : rel;
    const touchPart = hasTouchData ? `touches=${m.touchCount ?? "?"}  ` : "";
    const syntaxWarning = m.hasSyntaxErrors ? "⚠ SYNTAX ERROR — numbers below are unreliable  " : "";

    let deltaPart = "";
    if (baseline) {
      const delta = computeDelta(m, baseline, repoPath);
      deltaPart = delta.isNew
        ? "NEW  "
        : `Δcomplexity=${formatDelta(delta.complexityDelta)} Δlines=${formatDelta(delta.linesDelta)}  `;
    }

    console.log(
      `  ${Math.round(computeOutlierScore(m)).toString().padStart(5)}  ` +
        `${syntaxWarning}complexity=${m.cyclomaticComplexity}  lines=${m.lines}  ` +
        `fanIn=${m.fanIn}  ${touchPart}exports=${m.exportedSymbols.length}  ${deltaPart}${displayPath}`
    );
  }
  if (!hasTouchData) {
    console.log(`  (no git history found — touch-frequency signal unavailable)`);
  }
  if (baseline) {
    console.log(`  (comparing against baseline from ${baseline.createdAt.slice(0, 10)})`);
  } else {
    console.log(
      `  (no baseline found — run 'cambium baseline ${repoPath}' to start tracking change over time)`
    );
  }

  const brokenCount = results.filter((m) => m.hasSyntaxErrors).length;
  if (brokenCount > 0) {
    console.log(
      `  ⚠ ${brokenCount} file(s) in this repo have syntax errors and couldn't be ` +
        `parsed correctly — their metrics above are not trustworthy. Fix the syntax ` +
        `before trusting any score for those files.`
    );
  }
  console.log("");
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan a repo for structural outliers (static metrics only, no LLM, no cost)")
    .argument("<repoPath>", "path to the repo root")
    .option("-n, --top <number>", "how many outliers to show", "25")
    .option("-o, --output <path>", "save results as a markdown report (or JSON when using --json) to this file")
    .option(
      "--exclude-tests",
      "exclude regular test files (*.test.ts, *.spec.ts) from results — " +
        "off by default, since test-file drift can be real signal too"
    )
    .option("--json", "output raw JSON instead of formatted table")
    .action((repoPath: string, opts: { top: string; output?: string; excludeTests?: boolean; json?: boolean }) => {
      if (!opts.json) {
        console.error(`Scanning ${repoPath} ...`);
      }
      let rawResults;
      try {
        rawResults = scanRepo(repoPath);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      if (!opts.json) {
        console.error(`Found ${rawResults.length} file(s).`);
      }

      if (opts.excludeTests) {
        const beforeCount = rawResults.length;
        rawResults = rawResults.filter((m) => !isTestFile(m.filePath));
        const excluded = beforeCount - rawResults.length;
        if (excluded > 0 && !opts.json) {
          console.error(`Excluding ${excluded} test file(s) (--exclude-tests).`);
        }
      }

      const touchFrequency = getTouchFrequency(repoPath);
      const results = attachTouchFrequency(rawResults, touchFrequency);
      const baseline = loadBaseline(repoPath);

      const limit = parseInt(opts.top, 10);

      if (opts.json) {
        const jsonReport = buildScanJsonReport(results, limit, repoPath, baseline);
        console.log(JSON.stringify(jsonReport, null, 2));

        if (opts.output) {
          fs.writeFileSync(opts.output, JSON.stringify(jsonReport, null, 2), "utf-8");
          console.error(`JSON report saved to ${opts.output}`);
        }
      } else {
        printOutlierTable(results, limit, repoPath, baseline);

        if (opts.output) {
          const markdown = formatScanReportMarkdown(results, repoPath, limit);
          fs.writeFileSync(opts.output, markdown, "utf-8");
          console.error(`Report saved to ${opts.output}`);
        }
      }
    });
}
