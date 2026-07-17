import { DriftAnalysis } from "./drift-types";

export function parseModelJson(rawText: string): any {
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

export function validateDriftAnalysis(
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
