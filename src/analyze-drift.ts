import * as fs from "fs";
import { Agent, setGlobalDispatcher } from "undici";
import { RepoFileMetrics } from "./scan-repo";

// Node's default fetch timeout is 5 minutes, which local CPU inference
// on larger files can easily exceed. Remove the timeout entirely for
// this process — local inference has no hard ceiling on how long it
// should be allowed to take.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));


export interface DriftAnalysis {
  filePath: string;
  inferredOriginalPurpose: string;
  currentResponsibilities: string[];
  hasDrifted: boolean;
  driftSummary: string;
  suggestedSplit: {
    newFileName: string;
    responsibility: string;
    movedExports: string[];
  }[] | null;
  warnings: string[];
}

export type LLMProvider =
  | { kind: "anthropic"; apiKey: string; model?: string }
  | { kind: "ollama"; baseUrl?: string; model?: string };

const SYSTEM_PROMPT = `You are a senior software architect reviewing a TypeScript file for structural drift.

Structural drift means: a file that started with one coherent purpose has
accumulated additional, unrelated responsibilities over time, so its current
scope no longer matches what its name and original design suggest.

You will be given a file's path, its exported symbol names, and its full
source. Do this:

1. Infer the file's ORIGINAL intended purpose from its name and the shape of
   its earliest-looking exports.
2. List the DISTINCT responsibilities actually present in the current code
   (only genuinely distinct concerns, not every function individually).
3. Decide whether the file has drifted: does it now bundle two or more
   responsibilities that don't share a single coherent purpose?
4. If it has drifted, propose a concrete split: new file names, one line on
   each file's responsibility, and which currently-exported symbols would
   move to each.

Respond with ONLY valid JSON matching this exact shape, no markdown fences,
no preamble:

{
  "inferredOriginalPurpose": string,
  "currentResponsibilities": string[],
  "hasDrifted": boolean,
  "driftSummary": string,
  "suggestedSplit": [
    { "newFileName": string, "responsibility": string, "movedExports": string[] }
  ] | null
}

If hasDrifted is false, suggestedSplit must be null.`;

// Rough safety cap. ~4 chars/token is a common approximation; capping
// source at ~24,000 chars (~6,000 tokens) leaves plenty of room for
// the system prompt and output within a 16k context window, even for
// very large files. Files this big are rare among your outliers anyway.
const MAX_SOURCE_CHARS = 24000;

function buildUserPrompt(filePath: string, exportedSymbols: string[], source: string): string {
  let trimmedSource = source;
  let truncationNote = "";

  if (source.length > MAX_SOURCE_CHARS) {
    trimmedSource = source.slice(0, MAX_SOURCE_CHARS);
    truncationNote = `\n\n[TRUNCATED — file continues beyond this point. Base your analysis on what's shown; note in driftSummary that this was a partial read if it matters.]`;
  }

  return `File path: ${filePath}
Exported symbols: ${JSON.stringify(exportedSymbols)}

Source:
\`\`\`typescript
${trimmedSource}${truncationNote}
\`\`\``;
}

function parseModelJson(rawText: string): any {
  const cleaned = rawText.replace(/^```json\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse model response as JSON: ${rawText.slice(0, 300)}`);
  }
}

/**
 * The model's qualitative read (what the responsibilities are, whether
 * drift occurred) has proven reliable in testing. The mechanical part —
 * assigning each symbol to exactly one destination file — is more
 * error-prone. Catch the clearest failure mode: the same symbol name
 * assigned to more than one suggested file, which isn't a valid split.
 */
function findDuplicateSymbolWarnings(
  suggestedSplit: DriftAnalysis["suggestedSplit"]
): string[] {
  if (!suggestedSplit) return [];

  const seenIn = new Map<string, string[]>(); // symbol -> file names it appears in

  for (const entry of suggestedSplit) {
    for (const symbol of entry.movedExports) {
      const files = seenIn.get(symbol) ?? [];
      files.push(entry.newFileName);
      seenIn.set(symbol, files);
    }
  }

  const warnings: string[] = [];
  for (const [symbol, files] of seenIn) {
    if (files.length > 1) {
      warnings.push(
        `"${symbol}" appears in multiple suggested files (${files.join(", ")}) — ` +
          `treat this split as a starting point, not a ready-to-execute plan.`
      );
    }
  }

  return warnings;
}

/**
 * Cross-check the model's suggested split against the file's ACTUAL
 * exported symbols (computed by static analysis, not inferred by the
 * model). The model reads the whole file and often names internal
 * helper functions it noticed while reading — those aren't real
 * exports and can't actually be "moved" the way the model implies.
 *
 * For files with zero real exports (common — e.g. closures with no
 * module-level exports), every suggested symbol is by definition
 * unverifiable, so we give one summary warning instead of spamming
 * one line per symbol.
 */
function findUnknownSymbolWarnings(
  suggestedSplit: DriftAnalysis["suggestedSplit"],
  actualExportedSymbols: string[]
): string[] {
  if (!suggestedSplit) return [];

  if (actualExportedSymbols.length === 0) {
    const anySuggested = suggestedSplit.some((e) => e.movedExports.length > 0);
    if (anySuggested) {
      return [
        `This file has no real exported symbols (everything is likely trapped in closures), ` +
          `so the suggested symbol names below are the model's best guess from reading the code, ` +
          `not verified exports — expect to rename/adjust when actually decomposing.`,
      ];
    }
    return [];
  }

  const actualSet = new Set(actualExportedSymbols);
  const unknown = new Set<string>();

  for (const entry of suggestedSplit) {
    for (const symbol of entry.movedExports) {
      if (!actualSet.has(symbol)) {
        unknown.add(symbol);
      }
    }
  }

  if (unknown.size === 0) return [];

  return [
    `${unknown.size} suggested symbol(s) don't match this file's actual exports and may be ` +
      `inferred internal names: ${[...unknown].join(", ")}.`,
  ];
}

function validateDriftAnalysis(
  parsed: any,
  rawText: string,
  actualExportedSymbols: string[]
): Omit<DriftAnalysis, "filePath"> {
  const required = [
    "inferredOriginalPurpose",
    "currentResponsibilities",
    "hasDrifted",
    "driftSummary",
  ];
  const missing = required.filter((key) => !(key in parsed));

  if (missing.length > 0) {
    throw new Error(
      `Model response missing field(s): ${missing.join(", ")}. ` +
        `Raw response (first 500 chars): ${rawText.slice(0, 500)}`
    );
  }

  const suggestedSplit = parsed.suggestedSplit ?? null;

  return {
    inferredOriginalPurpose: parsed.inferredOriginalPurpose,
    currentResponsibilities: parsed.currentResponsibilities,
    hasDrifted: parsed.hasDrifted,
    driftSummary: parsed.driftSummary,
    suggestedSplit,
    warnings: [
      ...findDuplicateSymbolWarnings(suggestedSplit),
      ...findUnknownSymbolWarnings(suggestedSplit, actualExportedSymbols),
    ],
  };
}

async function callAnthropic(
  provider: { apiKey: string; model?: string },
  filePath: string,
  exportedSymbols: string[],
  source: string
): Promise<DriftAnalysis> {
  const userPrompt = buildUserPrompt(filePath, exportedSymbols, source);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: provider.model ?? "claude-sonnet-5",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((c: any) => c.type === "text");
  if (!textBlock) throw new Error("No text block in Claude response");

  const parsed = parseModelJson(textBlock.text);
  const validated = validateDriftAnalysis(parsed, textBlock.text, exportedSymbols);
  return { filePath, ...validated };
}

/**
 * Ollama runs fully locally — no API key, no cost.
 * Defaults to 127.0.0.1 rather than localhost to avoid IPv6/IPv4
 * resolution mismatches on Windows that cause "fetch failed".
 */
async function callOllama(
  provider: { baseUrl?: string; model?: string },
  filePath: string,
  exportedSymbols: string[],
  source: string
): Promise<DriftAnalysis> {
  const userPrompt = buildUserPrompt(filePath, exportedSymbols, source);
  const baseUrl = provider.baseUrl ?? "http://127.0.0.1:11434";
  const model = provider.model ?? "qwen2.5-coder:latest";

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      stream: false,
      format: "json",
      options: {
        // Ollama defaults to a 2048-token context window, which is
        // nowhere near enough for a large source file plus the system
        // prompt — the model silently truncates and can return
        // garbage/empty JSON instead of erroring. Raise it well above
        // what a large TS file + prompt needs.
        num_ctx: 16384,
        // Cap generation length — our expected JSON output is modest,
        // and an unbounded cap risks the model rambling/looping,
        // which is likely part of why this took 35 minutes.
        num_predict: 1200,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Ollama error ${response.status}: ${errText}\n` +
        `Is Ollama running? Make sure you've pulled the model: ollama pull ${model}`
    );
  }

  const data = await response.json();
  const rawText = data?.message?.content;
  if (!rawText) throw new Error("No content in Ollama response");

  const parsed = parseModelJson(rawText);
  const validated = validateDriftAnalysis(parsed, rawText, exportedSymbols);
  return { filePath, ...validated };
}

async function callLLM(
  provider: LLMProvider,
  filePath: string,
  exportedSymbols: string[],
  source: string
): Promise<DriftAnalysis> {
  if (provider.kind === "anthropic") {
    return callAnthropic(provider, filePath, exportedSymbols, source);
  }
  return callOllama(provider, filePath, exportedSymbols, source);
}

function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Run the LLM drift pass over a list of outlier files, with progress
 * logged to stderr per file (so it doesn't pollute the JSON stdout
 * output) — local inference can take anywhere from a few seconds to
 * over a minute per file depending on hardware, so visible progress
 * matters here.
 */
export async function analyzeDrift(
  outliers: RepoFileMetrics[],
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
        source
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
