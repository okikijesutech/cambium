import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { scanRepo } from "../scan-repo";
import { getTouchFrequency } from "../git-history";
import { attachTouchFrequency, computeOutlierScore } from "../scoring";
import {
  analyzeDrift,
  LLMProvider,
  DriftAnalysis,
  buildEmittedPrompts,
  emitPromptsToDirectory,
  evaluateExternalAnalysis,
} from "../analyze-drift";
import { formatDriftReportMarkdown } from "../report";
import { isTestFile } from "../test-file-detection";
import { normalizePathKey, toForwardSlashes } from "../git-paths";

function resolveProvider(): LLMProvider {
  const forced = process.env.LLM_PROVIDER; // "anthropic" | "gemini" | "ollama"
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (forced === "gemini" || (!forced && geminiKey && !anthropicKey)) {
    if (!geminiKey) {
      console.error("LLM_PROVIDER=gemini but GEMINI_API_KEY is not set.");
      process.exit(1);
    }
    return {
      kind: "gemini",
      apiKey: geminiKey,
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    };
  }

  if (forced === "anthropic" || (!forced && anthropicKey)) {
    if (!anthropicKey) {
      console.error("LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
      process.exit(1);
    }
    return {
      kind: "anthropic",
      apiKey: anthropicKey,
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest",
    };
  }

  return {
    kind: "ollama",
    baseUrl: process.env.OLLAMA_BASE_URL,
    model: process.env.OLLAMA_MODEL,
  };
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

  // A per-file failure is already reported as an ERROR entry (graceful
  // degradation is correct). But if EVERY file failed, the command
  // itself did not do its job — exit non-zero so scripts/CI checking
  // only the exit code don't mistake this for a successful run with
  // zero drifted files.
  if (analyses.length > 0 && errored === analyses.length) {
    console.error(
      `⚠ All ${errored} file(s) failed analysis — treating this run as failed (exit code 1).\n`
    );
    process.exitCode = 1;
  }
}

function renderAnalysesResult(
  analyses: DriftAnalysis[],
  opts: { json?: boolean; output?: string },
  repoPath: string
) {
  printDriftSummary(analyses);

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

export function registerDriftCommand(program: Command): void {
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
    .option(
      "--exclude-tests",
      "exclude regular test files (*.test.ts, *.spec.ts) from results — " +
        "off by default, since test-file drift can be real signal too"
    )
    .option(
      "-f, --file <path>",
      "analyze exactly this file, skipping ranking and --min-lines/--min-complexity " +
        "entirely — use this to target a specific file (e.g. the 2nd-ranked one from " +
        "'cambium scan') without re-analyzing everything ranked above it"
    )
    .option("--ignore <pattern...>", "one or more glob patterns to ignore (e.g. 'src/data/**')")
    .option("--no-ignore-file", "do not read .cambiumignore file")
    .option(
      "--emit-prompts [dir]",
      "emit drift analysis prompts (to directory or stdout if --json) without calling an LLM"
    )
    .option(
      "--eval <path>",
      "evaluate external JSON analysis results against Cambium guardrails and produce reports"
    )
    .action(
      async (
        repoPath: string,
        opts: {
          top: string;
          json?: boolean;
          minLines: string;
          minComplexity: string;
          output?: string;
          excludeTests?: boolean;
          file?: string;
          ignore?: string[];
          ignoreFile?: boolean;
          emitPrompts?: boolean | string;
          eval?: string;
        }
      ) => {
        if (!opts.json) {
          console.error(`Scanning ${repoPath} ...`);
        }

        let rawResults;
        try {
          rawResults = scanRepo(repoPath, {
            ignorePatterns: opts.ignore,
            useCambiumIgnore: opts.ignoreFile,
          });
        } catch (err) {
          console.error(`Error: ${(err as Error).message}`);
          process.exit(1);
        }
        if (!opts.json) {
          console.error(`Found ${rawResults.length} file(s).`);
        }

        // --- Handle External Evaluation Ingestion Mode ---
        if (opts.eval) {
          let evalContent: string;
          try {
            evalContent = fs.readFileSync(opts.eval, "utf-8");
          } catch (err) {
            console.error(`Error reading evaluation file ${opts.eval}: ${(err as Error).message}`);
            process.exit(1);
          }

          let parsedEval: any;
          try {
            parsedEval = JSON.parse(evalContent);
          } catch (err) {
            console.error(`Error parsing JSON in ${opts.eval}: ${(err as Error).message}`);
            process.exit(1);
          }

          const analyses = evaluateExternalAnalysis(parsedEval, rawResults, repoPath);
          renderAnalysesResult(analyses, opts, repoPath);
          return;
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
        if (touchFrequency === null && !opts.json) {
          console.error(`(no git history found — touch-frequency signal unavailable)`);
        }
        const results = attachTouchFrequency(rawResults, touchFrequency);

        const brokenFiles = results.filter((m) => m.hasSyntaxErrors);
        if (brokenFiles.length > 0 && !opts.json) {
          console.error(
            `\n⚠ Excluding ${brokenFiles.length} file(s) with syntax errors — their metrics ` +
              `aren't trustworthy, so they're not eligible for drift analysis:`
          );
          for (const m of brokenFiles) {
            const shortName = m.filePath.split(/[\\/]/).pop();
            console.error(`  - ${shortName}`);
          }
        }
        const parseable = results.filter((m) => !m.hasSyntaxErrors);

        let top;

        if (opts.file) {
          const requestedAbs = toForwardSlashes(path.resolve(repoPath, opts.file));
          const requestedKey = normalizePathKey(requestedAbs);
          const match = parseable.find(
            (m) => normalizePathKey(m.filePath) === requestedKey
          );

          if (!match) {
            const brokenMatch = brokenFiles.find(
              (m) => normalizePathKey(m.filePath) === requestedKey
            );
            if (brokenMatch) {
              console.error(
                `Error: ${opts.file} has syntax errors — its metrics aren't trustworthy, ` +
                  `so it's not eligible for drift analysis. Fix the syntax first.`
              );
            } else {
              console.error(
                `Error: ${opts.file} was not found among the scanned .ts/.tsx files under ${repoPath}. ` +
                  `Check the path (relative to ${repoPath}) and that it isn't excluded ` +
                  `(node_modules, .d.ts, .test-d.ts, or --exclude-tests).`
              );
            }
            process.exit(1);
          }

          if (!opts.json) {
            console.error(`Targeting exactly one file (--file): ${opts.file}`);
          }
          top = [match];
        } else {
          const sorted = [...parseable].sort(
            (a, b) => computeOutlierScore(b) - computeOutlierScore(a)
          );
          const candidates = sorted.slice(0, parseInt(opts.top, 10));

          const minLines = parseInt(opts.minLines, 10);
          const minComplexity = parseInt(opts.minComplexity, 10);

          top = candidates.filter(
            (m) => m.lines >= minLines && m.cyclomaticComplexity >= minComplexity
          );
          const skipped = candidates.filter(
            (m) => !(m.lines >= minLines && m.cyclomaticComplexity >= minComplexity)
          );

          if (skipped.length > 0 && !opts.json) {
            console.error(
              `\nSkipping ${skipped.length} file(s) too small to warrant a multi-file split ` +
                `(need >= ${minLines} lines AND >= complexity ${minComplexity}):`
            );
            for (const m of skipped) {
              const shortName = m.filePath.split(/[\\/]/).pop();
              console.error(`  - ${shortName} (lines=${m.lines}, complexity=${m.cyclomaticComplexity})`);
            }
          }
        }

        if (top.length === 0) {
          if (!opts.json) {
            console.error(`\nNo files met the threshold for drift analysis. Nothing to do.`);
          }
          return;
        }

        // --- Handle Prompt Emission Mode ---
        if (opts.emitPrompts) {
          const emittedPrompts = buildEmittedPrompts(top, repoPath);

          if (opts.json) {
            console.log(JSON.stringify(emittedPrompts, null, 2));
            if (opts.output) {
              fs.writeFileSync(opts.output, JSON.stringify(emittedPrompts, null, 2), "utf-8");
              console.error(`Emitted prompts JSON saved to ${opts.output}`);
            }
          } else {
            const targetDir =
              typeof opts.emitPrompts === "string"
                ? opts.emitPrompts
                : path.join(repoPath, ".cambium", "prompts");
            const written = emitPromptsToDirectory(emittedPrompts, targetDir);
            console.log(`\nEmitted ${written.length} prompt(s) to ${targetDir}:`);
            for (const w of written) {
              console.log(`  - ${path.relative(repoPath, w)}`);
            }
            if (opts.output) {
              fs.writeFileSync(opts.output, JSON.stringify(emittedPrompts, null, 2), "utf-8");
              console.error(`Emitted prompts JSON saved to ${opts.output}`);
            }
          }
          return;
        }

        // --- Live LLM Inference Mode ---
        const provider = resolveProvider();
        if (!opts.json) {
          console.error(
            `Using LLM provider: ${provider.kind}` +
              (provider.kind === "ollama" ? ` (${provider.model ?? "qwen2.5-coder:latest"})` : "")
          );
          console.error(`\nRunning LLM drift analysis on top ${top.length} outlier file(s):`);
          if (provider.kind === "ollama") {
            console.error(
              "(local inference — each file may take anywhere from a few seconds to several minutes depending on your hardware)"
            );
          }
        }

        const started = Date.now();
        const analyses = await analyzeDrift(top, provider);
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);

        if (!opts.json) {
          console.error(`Total time: ${elapsed}s\n`);
        }

        renderAnalysesResult(analyses, opts, repoPath);
      }
    );
}
