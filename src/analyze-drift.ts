import * as fs from "fs";
import { ScoredFileMetrics } from "./scoring";
import { callLLM } from "./llm-providers";

// Re-exported so existing consumers (cli.ts, report.ts) don't need to
// change their import path — this refactor is internal reorganization,
// not a public interface change.
export { DriftAnalysis, LLMProvider } from "./drift-types";
import { DriftAnalysis, LLMProvider } from "./drift-types";

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Run the LLM drift pass over a list of outlier files, with progress
 * logged to stderr per file (so it doesn't pollute the JSON stdout
 * output) — local inference can take anywhere from a few seconds to
 * over a minute per file depending on hardware, so visible progress
 * matters here.
 *
 * Takes ScoredFileMetrics (not the base RepoFileMetrics) specifically
 * so touchCount is available to pass through to the LLM — the model
 * can now factor "this file keeps getting touched" into its read,
 * not just complexity/lines/exports.
 */
export async function analyzeDrift(
  outliers: ScoredFileMetrics[],
  provider: LLMProvider
): Promise<DriftAnalysis[]> {
  const results: DriftAnalysis[] = [];
  const total = outliers.length;

  for (let i = 0; i < total; i++) {
    const file = outliers[i];
    const shortName = file.filePath.split(/[\\/]/).pop();
    const started = Date.now();

    process.stderr.write(`  [${i + 1}/${total}] Analyzing ${shortName} ... `);

    const source = fs.readFileSync(file.filePath, "utf-8");
    try {
      const analysis = await callLLM(
        provider,
        file.filePath,
        file.exportedSymbols,
        source,
        file.touchCount,
        file.importedSymbolNames
      );
      results.push(analysis);
      process.stderr.write(`done (${formatElapsed(Date.now() - started)})\n`);
    } catch (err) {
      process.stderr.write(`FAILED (${formatElapsed(Date.now() - started)})\n`);
      results.push({
        filePath: file.filePath,
        inferredOriginalPurpose: "ERROR",
        currentResponsibilities: [],
        hasDrifted: false,
        driftSummary: `Analysis failed: ${(err as Error).message}`,
        suggestedSplit: null,
        warnings: [],
      });
    }
  }

  return results;
}
