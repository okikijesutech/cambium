import * as fs from "fs";
import * as path from "path";
import { ScoredFileMetrics } from "./scoring";
import { RepoFileMetrics } from "./scan-repo";
import { callLLM } from "./llm-providers";
import { SYSTEM_PROMPT, buildUserPrompt } from "./drift-prompt";
import { toForwardSlashes, normalizePathKey } from "./git-paths";
import { validateDriftAnalysis } from "./drift-validation";

// Re-exported so existing consumers (cli.ts, report.ts) don't need to
// change their import path — this refactor is internal reorganization,
// not a public interface change.
export { DriftAnalysis, LLMProvider, EmittedPrompt } from "./drift-types";
import { DriftAnalysis, LLMProvider, EmittedPrompt } from "./drift-types";

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Builds standardized prompt payloads for outlier files so agents or developers
 * can evaluate drift without requiring a live LLM daemon or external API keys.
 */
export function buildEmittedPrompts(
  outliers: ScoredFileMetrics[],
  repoPath: string
): EmittedPrompt[] {
  const resolvedRepo = toForwardSlashes(path.resolve(repoPath));

  return outliers.map((file) => {
    const source = fs.readFileSync(file.filePath, "utf-8");
    const resolvedFile = toForwardSlashes(path.resolve(file.filePath));
    let rel = toForwardSlashes(path.relative(resolvedRepo, resolvedFile));
    if (!rel || rel.startsWith("../")) {
      rel = toForwardSlashes(file.filePath);
    }

    const userPrompt = buildUserPrompt(
      rel,
      file.exportedSymbols,
      source,
      file.touchCount
    );

    return {
      filePath: toForwardSlashes(file.filePath),
      relativeFilePath: rel,
      exportedSymbols: file.exportedSymbols,
      importedSymbolNames: file.importedSymbolNames,
      touchCount: file.touchCount,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
    };
  });
}

/**
 * Writes emitted prompt payloads as Markdown files to a destination directory.
 */
export function emitPromptsToDirectory(
  prompts: EmittedPrompt[],
  targetDir: string
): string[] {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const writtenFiles: string[] = [];

  for (const p of prompts) {
    const baseName = path.basename(p.filePath).replace(/\.[^/.]+$/, "");
    const outPath = path.join(targetDir, `${baseName}.drift-prompt.md`);

    const markdown = `# Cambium Drift Analysis Prompt: ${p.relativeFilePath}

## System Prompt
${p.systemPrompt}

---

## Instructions for LLM / AI Agent
Evaluate this file for structural drift. Respond with ONLY valid JSON matching this exact shape:

\`\`\`json
{
  "inferredOriginalPurpose": "string",
  "currentResponsibilities": ["string"],
  "hasDrifted": true,
  "driftSummary": "string",
  "suggestedSplit": [
    {
      "newFileName": "string",
      "responsibility": "string",
      "movedExports": ["string"]
    }
  ]
}
\`\`\`

If \`hasDrifted\` is false, \`suggestedSplit\` must be \`null\`.

---

## User Prompt
${p.userPrompt}
`;

    fs.writeFileSync(outPath, markdown, "utf-8");
    writtenFiles.push(outPath);
  }

  return writtenFiles;
}

/**
 * Ingests and validates an external evaluation JSON against Cambium's guardrails,
 * verifying that suggested splits and moved exports match real codebase declarations.
 */
export function evaluateExternalAnalysis(
  rawPayload: any,
  repoFiles: RepoFileMetrics[],
  repoPath: string
): DriftAnalysis[] {
  const items: any[] = Array.isArray(rawPayload) ? rawPayload : [rawPayload];
  const results: DriftAnalysis[] = [];
  const resolvedRepo = toForwardSlashes(path.resolve(repoPath));

  for (const item of items) {
    if (!item || typeof item !== "object") continue;

    const rawPath = item.filePath || item.file || "unknown";
    const resolvedTarget = toForwardSlashes(path.resolve(repoPath, rawPath));
    const targetKey = normalizePathKey(resolvedTarget);

    const match = repoFiles.find(
      (m) => normalizePathKey(toForwardSlashes(path.resolve(m.filePath))) === targetKey
    );

    const exportedSymbols: string[] = match ? match.exportedSymbols : item.exportedSymbols ?? [];
    const importedSymbolNames: string[] = match ? match.importedSymbolNames : [];

    const rawText = JSON.stringify(item);
    const validated = validateDriftAnalysis(
      item,
      rawText,
      exportedSymbols,
      importedSymbolNames
    );

    let displayRel = rawPath;
    if (match) {
      displayRel = toForwardSlashes(path.relative(resolvedRepo, path.resolve(match.filePath)));
      if (!displayRel || displayRel.startsWith("../")) {
        displayRel = toForwardSlashes(match.filePath);
      }
    }

    results.push({
      filePath: displayRel,
      ...validated,
    });
  }

  return results;
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
