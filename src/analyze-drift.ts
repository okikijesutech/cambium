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

function buildUserPrompt(filePath: string, exportedSymbols: string[], source: string): string {
  return `File path: ${filePath}
Exported symbols: ${JSON.stringify(exportedSymbols)}

Source:
\`\`\`typescript
${source}
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
  return {
    filePath,
    inferredOriginalPurpose: parsed.inferredOriginalPurpose,
    currentResponsibilities: parsed.currentResponsibilities,
    hasDrifted: parsed.hasDrifted,
    driftSummary: parsed.driftSummary,
    suggestedSplit: parsed.suggestedSplit,
  };
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
  return {
    filePath,
    inferredOriginalPurpose: parsed.inferredOriginalPurpose,
    currentResponsibilities: parsed.currentResponsibilities,
    hasDrifted: parsed.hasDrifted,
    driftSummary: parsed.driftSummary,
    suggestedSplit: parsed.suggestedSplit,
  };
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
      });
    }
  }

  return results;
}
