import { Command } from "commander";
import * as fs from "fs";
import { scanRepo } from "../scan-repo";
import { getTouchFrequency } from "../git-history";
import { attachTouchFrequency, computeOutlierScore, ScoredFileMetrics } from "../scoring";
import { formatScanReportMarkdown } from "../report";
import { loadBaseline, computeDelta, Baseline } from "../baseline";

function formatDelta(n: number): string {
  if (n === 0) return "±0";
  return n > 0 ? `+${n}` : `${n}`;
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

  console.log(
    `\nTop ${top.length} outlier(s) of ${results.length} file(s) scanned:\n`
  );

  for (const m of top) {
    const shortPath = m.filePath.split(/[\\/]/).slice(-3).join("/");
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
        `fanIn=${m.fanIn}  ${touchPart}exports=${m.exportedSymbols.length}  ${deltaPart}${shortPath}`
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
    .option("-o, --output <path>", "save results as a markdown report to this file")
    .action((repoPath: string, opts: { top: string; output?: string }) => {
      console.error(`Scanning ${repoPath} ...`);
      let rawResults;
      try {
        rawResults = scanRepo(repoPath);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      console.error(`Found ${rawResults.length} file(s).`);

      const touchFrequency = getTouchFrequency(repoPath);
      const results = attachTouchFrequency(rawResults, touchFrequency);
      const baseline = loadBaseline(repoPath);

      const limit = parseInt(opts.top, 10);
      printOutlierTable(results, limit, repoPath, baseline);

      if (opts.output) {
        const markdown = formatScanReportMarkdown(results, repoPath, limit);
        fs.writeFileSync(opts.output, markdown, "utf-8");
        console.error(`Report saved to ${opts.output}`);
      }
    });
}
