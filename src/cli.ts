#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import { computeMetricsForSingleFile } from "./metrics";
import { scanRepo, RepoFileMetrics } from "./scan-repo";
import { analyzeDrift, LLMProvider, DriftAnalysis } from "./analyze-drift";
import { loadDotEnv } from "./dotenv";

loadDotEnv(path.join(__dirname, ".."));

const program = new Command();

program
  .name("cambium")
  .description(
    "Structural drift detection — finds files whose scope has outgrown their original design."
  )
  .version("0.1.0");

function outlierScore(m: { cyclomaticComplexity: number; lines: number; fanIn: number }): number {
  return m.cyclomaticComplexity * 2 + m.lines * 0.1 + m.fanIn * 3;
}

function printOutlierTable(results: RepoFileMetrics[], limit: number) {
  const sorted = [...results].sort((a, b) => outlierScore(b) - outlierScore(a));
  const top = sorted.slice(0, limit);

  console.log(
    `\nTop ${top.length} outlier(s) of ${results.length} file(s) scanned:\n`
  );

  for (const m of top) {
    const shortPath = m.filePath.split(/[\\/]/).slice(-3).join("/");
    console.log(
      `  ${Math.round(outlierScore(m)).toString().padStart(5)}  ` +
        `complexity=${m.cyclomaticComplexity}  lines=${m.lines}  ` +
        `fanIn=${m.fanIn}  exports=${m.exportedSymbols.length}  ${shortPath}`
    );
  }
  console.log("");
}

function resolveProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER; // "anthropic" | "ollama"
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (forced === "ollama" || (!forced && !apiKey)) {
    return {
      kind: "ollama",
      baseUrl: process.env.OLLAMA_BASE_URL,
      model: process.env.OLLAMA_MODEL,
    };
  }

  if (!apiKey) {
    console.error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  return { kind: "anthropic", apiKey, model: process.env.ANTHROPIC_MODEL };
}

function printDriftSummary(analyses: DriftAnalysis[]) {
  const drifted = analyses.filter((a) => a.hasDrifted).length;
  const errored = analyses.filter((a) => a.inferredOriginalPurpose === "ERROR").length;
  const withWarnings = analyses.filter((a) => a.warnings.length > 0);

  console.error(
    `\nSummary: ${analyses.length} file(s) analyzed, ${drifted} flagged as drifted, ${errored} failed.`
  );

  if (withWarnings.length > 0) {
    console.error(
      `\n⚠ ${withWarnings.length} file(s) have suggested splits with issues — review before acting on them:`
    );
    for (const a of withWarnings) {
      const shortName = a.filePath.split(/[\\/]/).pop();
      console.error(`  ${shortName}:`);
      for (const w of a.warnings) console.error(`    - ${w}`);
    }
  }
  console.error("");
}

program
  .command("scan")
  .description("Scan a repo for structural outliers (static metrics only, no LLM, no cost)")
  .argument("<repoPath>", "path to the repo root")
  .option("-n, --top <number>", "how many outliers to show", "25")
  .action((repoPath: string, opts: { top: string }) => {
    console.error(`Scanning ${repoPath} ...`);
    const results = scanRepo(repoPath);
    console.error(`Found ${results.length} file(s).`);
    printOutlierTable(results, parseInt(opts.top, 10));
  });

program
  .command("drift")
  .description(
    "Scan a repo, then run LLM analysis on the top outliers to explain drift and suggest a split"
  )
  .argument("<repoPath>", "path to the repo root")
  .option("-n, --top <number>", "how many top outliers to analyze", "5")
  .option("--json", "output raw JSON instead of a formatted summary")
  .option(
    "--min-lines <number>",
    "skip files below this line count AND below --min-complexity (avoids wasting time on trivially small files)",
    "80"
  )
  .option(
    "--min-complexity <number>",
    "skip files below this complexity AND below --min-lines",
    "8"
  )
  .action(
    async (
      repoPath: string,
      opts: { top: string; json?: boolean; minLines: string; minComplexity: string }
    ) => {
      const provider = resolveProvider();
      console.error(
        `Using LLM provider: ${provider.kind}` +
          (provider.kind === "ollama" ? ` (${provider.model ?? "qwen2.5-coder:latest"})` : "")
      );
      console.error(`Scanning ${repoPath} ...`);

      const results = scanRepo(repoPath);
      console.error(`Found ${results.length} file(s).`);

      const sorted = [...results].sort((a, b) => outlierScore(b) - outlierScore(a));
      const candidates = sorted.slice(0, parseInt(opts.top, 10));

      const minLines = parseInt(opts.minLines, 10);
      const minComplexity = parseInt(opts.minComplexity, 10);

      // Skip files that are too small to be worth SPLITTING INTO MULTIPLE
      // FILES, regardless of internal complexity. A 36-line function can
      // be messy (worth simplifying) without being a candidate for
      // decomposition into separate modules — that only makes sense once
      // a file is both long enough AND complex enough to warrant it.
      const top = candidates.filter(
        (m) => m.lines >= minLines && m.cyclomaticComplexity >= minComplexity
      );
      const skipped = candidates.filter(
        (m) => !(m.lines >= minLines && m.cyclomaticComplexity >= minComplexity)
      );

      if (skipped.length > 0) {
        console.error(
          `\nSkipping ${skipped.length} file(s) too small to warrant a multi-file split ` +
            `(need >= ${minLines} lines AND >= complexity ${minComplexity}):`
        );
        for (const m of skipped) {
          const shortName = m.filePath.split(/[\\/]/).pop();
          console.error(`  - ${shortName} (lines=${m.lines}, complexity=${m.cyclomaticComplexity})`);
        }
      }

      if (top.length === 0) {
        console.error(`\nNo files met the threshold for drift analysis. Nothing to do.`);
        return;
      }

      console.error(`\nRunning LLM drift analysis on top ${top.length} outlier file(s):`);
      if (provider.kind === "ollama") {
        console.error(
          "(local inference — each file may take anywhere from a few seconds to several minutes depending on your hardware)"
        );
      }

      const started = Date.now();
      const analyses = await analyzeDrift(top, provider);
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);

      printDriftSummary(analyses);
      console.error(`Total time: ${elapsed}s\n`);

      if (opts.json) {
        console.log(JSON.stringify(analyses, null, 2));
      } else {
        for (const a of analyses) {
          const shortName = a.filePath.split(/[\\/]/).pop();
          console.log(`\n${"=".repeat(60)}`);
          console.log(`${shortName}`);
          console.log("=".repeat(60));
          if (a.inferredOriginalPurpose === "ERROR") {
            console.log(`Analysis failed: ${a.driftSummary}`);
            continue;
          }
          console.log(`\nOriginal purpose: ${a.inferredOriginalPurpose}`);
          console.log(`\nCurrent responsibilities:`);
          for (const r of a.currentResponsibilities) console.log(`  - ${r}`);
          console.log(`\nDrifted: ${a.hasDrifted ? "YES" : "no"}`);
          console.log(`${a.driftSummary}`);
          if (a.suggestedSplit) {
            console.log(`\nSuggested split:`);
            for (const s of a.suggestedSplit) {
              console.log(`  ${s.newFileName} — ${s.responsibility}`);
              console.log(`    exports: ${s.movedExports.join(", ")}`);
            }
          }
        }
        console.log("");
      }
    }
  );

program
  .command("file")
  .description("Show metrics for a single file")
  .argument("<filePath>", "path to a .ts/.tsx file")
  .action((filePath: string) => {
    const metrics = computeMetricsForSingleFile(filePath);
    console.log(JSON.stringify(metrics, null, 2));
  });

program.parse();
