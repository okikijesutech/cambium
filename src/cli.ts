#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { computeMetricsForSingleFile } from "./metrics";
import { scanRepo, RepoFileMetrics } from "./scan-repo";
import { analyzeDrift, LLMProvider, DriftAnalysis } from "./analyze-drift";
import { loadDotEnv } from "./dotenv";
import { formatScanReportMarkdown, formatDriftReportMarkdown } from "./report";
import { computeOutlierScore, attachTouchFrequency, ScoredFileMetrics } from "./scoring";
import { getTouchFrequency } from "./git-history";

loadDotEnv(path.join(__dirname, ".."));

const program = new Command();

// Read version from package.json rather than hardcoding it here —
// a hardcoded string is exactly the kind of thing that silently goes
// stale across releases (this one already had: it said 0.1.0 while
// package.json was at 1.0.0).
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
);

program
  .name("cambium")
  .description(
    "Structural drift detection — finds files whose scope has outgrown their original design."
  )
  .version(packageJson.version)
  .addHelpText(
    "after",
    `
Quick start:
  $ cambium scan ./my-repo                 # fast, free, no LLM
  $ cambium drift ./my-repo --top 3         # LLM-explained, slower
  $ cambium install-hook .                  # auto-check on every commit

Run 'cambium <command> --help' for that command's full options
(each command has its own flags — see e.g. 'cambium drift --help').`
  );

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
  .option("-o, --output <path>", "save results as a markdown report to this file")
  .action(
    async (
      repoPath: string,
      opts: {
        top: string;
        json?: boolean;
        minLines: string;
        minComplexity: string;
        output?: string;
      }
    ) => {
      const provider = resolveProvider();
      console.error(
        `Using LLM provider: ${provider.kind}` +
          (provider.kind === "ollama" ? ` (${provider.model ?? "qwen2.5-coder:latest"})` : "")
      );
      console.error(`Scanning ${repoPath} ...`);

      const rawResults = scanRepo(repoPath);
      console.error(`Found ${rawResults.length} file(s).`);

      const touchFrequency = getTouchFrequency(repoPath);
      if (touchFrequency === null) {
        console.error(`(no git history found — touch-frequency signal unavailable)`);
      }
      const results = attachTouchFrequency(rawResults, touchFrequency);

      const sorted = [...results].sort(
        (a, b) => computeOutlierScore(b) - computeOutlierScore(a)
      );
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

      if (opts.output) {
        const markdown = formatDriftReportMarkdown(analyses, repoPath);
        fs.writeFileSync(opts.output, markdown, "utf-8");
        console.error(`Report saved to ${opts.output}`);
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

program
  .command("check")
  .description(
    "Fast pass/fail check for a single file — warns (or fails, with --strict) if it's grown big and complex enough to warrant a real look. Designed for git hooks and CI."
  )
  .argument("<filePath>", "path to a .ts/.tsx file")
  .option("--min-lines <number>", "flag threshold for line count", "80")
  .option("--min-complexity <number>", "flag threshold for complexity", "8")
  .option("--strict", "exit non-zero when flagged, instead of warning only")
  .action(
    (
      filePath: string,
      opts: { minLines: string; minComplexity: string; strict?: boolean }
    ) => {
      const metrics = computeMetricsForSingleFile(filePath);
      const minLines = parseInt(opts.minLines, 10);
      const minComplexity = parseInt(opts.minComplexity, 10);
      const flagged = metrics.lines >= minLines && metrics.cyclomaticComplexity >= minComplexity;

      if (!flagged) {
        console.log(`OK  ${filePath}  (lines=${metrics.lines}, complexity=${metrics.cyclomaticComplexity})`);
        return;
      }

      const message =
        `${opts.strict ? "FAIL" : "WARN"}  ${filePath}  ` +
        `(lines=${metrics.lines}, complexity=${metrics.cyclomaticComplexity}) — ` +
        `big/complex enough to warrant a look. Try: cambium drift <repo> --top 1`;

      if (opts.strict) {
        console.error(message);
        process.exitCode = 1;
      } else {
        console.log(message);
      }
    }
  );

program
  .command("install-hook")
  .description(
    "Install a git pre-commit hook that runs 'cambium check' on every staged .ts/.tsx file"
  )
  .argument("[repoPath]", "path to the repo root", ".")
  .option(
    "--strict",
    "make the hook block commits when a file is flagged (default: warn only, never blocks)"
  )
  .action((repoPath: string, opts: { strict?: boolean }) => {
    const gitHooksDir = path.join(repoPath, ".git", "hooks");
    if (!fs.existsSync(gitHooksDir)) {
      console.error(
        `No .git/hooks directory found at ${gitHooksDir} — is ${repoPath} a git repo?`
      );
      process.exit(1);
    }

    const hookPath = path.join(gitHooksDir, "pre-commit");
    const strictFlag = opts.strict ? " --strict" : "";

    const script = `#!/bin/sh
# Installed by \`cambium install-hook\` — runs a fast structural check
# on every staged .ts/.tsx file. ${opts.strict ? "Blocks commits" : "Warns only, never blocks"} when a file
# has grown big and complex enough to warrant a look.
#
# Bypass once with: git commit --no-verify
# Uninstall by deleting this file: .git/hooks/pre-commit

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(ts|tsx)$')

if [ -z "$FILES" ]; then
  exit 0
fi

STATUS=0
for FILE in $FILES; do
  cambium check "$FILE"${strictFlag}
  if [ $? -ne 0 ]; then
    STATUS=1
  fi
done

exit $STATUS
`;

    fs.writeFileSync(hookPath, script, { mode: 0o755 });
    console.log(`Installed pre-commit hook at ${hookPath}`);
    console.log(
      opts.strict
        ? "Mode: strict — flagged files will block commits (bypass with --no-verify)."
        : "Mode: warn only — flagged files are reported but never block commits."
    );
  });

program.parse();
