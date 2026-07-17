import { Agent, setGlobalDispatcher } from "undici";
import { DriftAnalysis, LLMProvider } from "./drift-types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./drift-prompt";
import { parseModelJson, validateDriftAnalysis } from "./drift-validation";

// Node's default fetch timeout is 5 minutes, which local CPU inference
// on larger files can easily exceed. Remove the timeout entirely for
// this process — local inference has no hard ceiling on how long it
// should be allowed to take.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

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
      temperature: 0,
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
        // and an unbounded cap risks the model rambling/looping.
        num_predict: 1200,
        // Default temperature samples randomly, so the same file can
        // get a different verdict on different runs — most visible on
        // genuinely borderline files where the "right" answer is close
        // to a coin flip. temperature 0 + a fixed seed makes output
        // repeatable: same file in, same analysis out, every time.
        temperature: 0,
        seed: 42,
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

export async function callLLM(
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
