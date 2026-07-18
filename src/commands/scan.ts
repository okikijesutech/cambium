import { Command } from "commander";
import * as fs from "fs";
import { scanRepo } from "../scan-repo";
import { getTouchFrequency } from "../git-history";
import { attachTouchFrequency, computeOutlierScore, ScoredFileMetrics } from "../scoring";
import { formatScanReportMarkdown } from "../report";

function printOutlierTable(results: ScoredFileMetrics[], limit: number) {
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
    console.log(
      `  ${Math.round(computeOutlierScore(m)).toString().padStart(5)}  ` +
        `complexity=${m.cyclomaticComplexity}  lines=${m.lines}  ` +
        `fanIn=${m.fanIn}  ${touchPart}exports=${m.exportedSymbols.length}  ${shortPath}`
    );
  }
  if (!hasTouchData) {
    console.log(`  (no git history found — touch-frequency signal unavailable)`);
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
      const rawResults = scanRepo(repoPath);
      console.error(`Found ${rawResults.length} file(s).`);

      const touchFrequency = getTouchFrequency(repoPath);
      const results = attachTouchFrequency(rawResults, touchFrequency);

      const limit = parseInt(opts.top, 10);
      printOutlierTable(results, limit);

      if (opts.output) {
        const markdown = formatScanReportMarkdown(results, repoPath, limit);
        fs.writeFileSync(opts.output, markdown, "utf-8");
        console.error(`Report saved to ${opts.output}`);
      }
    });
}
