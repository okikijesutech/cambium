import * as fs from "fs";
import * as path from "path";
import { scanRepo } from "./scan-repo";
import { analyzeDrift, LLMProvider, DriftAnalysis } from "./analyze-drift";

/**
 * Minimal .env loader — no new dependency needed for this. Reads
 * KEY=VALUE lines from a .env file next to package.json, if present,
 * and applies them to process.env (without overwriting anything
 * already set via `export` in the current shell).
 */
function loadDotEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const repoRoot = process.argv[2];
const topN = process.argv[3] ? parseInt(process.argv[3], 10) : 5;

if (!repoRoot) {
  console.error("Usage: ts-node src/run-drift.ts <path-to-repo-root> [topN=5]");
  process.exit(1);
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

function outlierScore(m: { cyclomaticComplexity: number; lines: number; fanIn: number }): number {
  return m.cyclomaticComplexity * 2 + m.lines * 0.1 + m.fanIn * 3;
}

function printSummary(analyses: DriftAnalysis[]) {
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
      for (const w of a.warnings) {
        console.error(`    - ${w}`);
      }
    }
  }
  console.error("");
}

async function main() {
  const provider = resolveProvider();
  console.error(`Using LLM provider: ${provider.kind}${provider.kind === "ollama" ? ` (${provider.model ?? "qwen2.5-coder:latest"})` : ""}`);
  console.error(`Scanning ${repoRoot} ...`);

  const results = scanRepo(repoRoot!);
  console.error(`Found ${results.length} files.`);

  const sorted = [...results].sort((a, b) => outlierScore(b) - outlierScore(a));
  const top = sorted.slice(0, topN);

  console.error(`Running LLM drift analysis on top ${top.length} outlier file(s):`);
  console.error(
    provider.kind === "ollama"
      ? "(local inference — each file may take anywhere from a few seconds to a minute or more depending on your hardware)"
      : ""
  );

  const overallStart = Date.now();
  const analyses = await analyzeDrift(top, provider);
  const totalElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);

  printSummary(analyses);
  console.error(`Total time: ${totalElapsed}s\n`);

  console.log(JSON.stringify(analyses, null, 2));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
