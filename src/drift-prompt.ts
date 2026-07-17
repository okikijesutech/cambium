export const SYSTEM_PROMPT = `You are a senior software architect reviewing a TypeScript file for structural drift.

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

export function buildUserPrompt(
  filePath: string,
  exportedSymbols: string[],
  source: string
): string {
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
