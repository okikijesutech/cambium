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
/**
 * The system prompt explicitly tells the model: "If hasDrifted is
 * false, suggestedSplit must be null." Nothing previously verified
 * compliance — a model response with hasDrifted:false but a non-empty
 * suggestedSplit passed through silently, and would render as
 * "Drifted: no" immediately followed by a "Suggested split:" section,
 * which is actively confusing to read.
 *
 * hasDrifted:false + non-empty split -> suppress the split (the
 * "not drifted" verdict takes precedence; presenting a split for a
 * file just declared coherent is misleading regardless of warnings).
 *
 * hasDrifted:true + no split -> can't fabricate a split, just warn
 * that the model gave a verdict without an actionable plan.
 */
function checkConsistency(
  hasDrifted: boolean,
  suggestedSplit: DriftAnalysis["suggestedSplit"]
): { warnings: string[]; correctedSplit: DriftAnalysis["suggestedSplit"] } {
  const hasRealSplit = !!suggestedSplit && suggestedSplit.length > 0;

  if (!hasDrifted && hasRealSplit) {
    return {
      warnings: [
        `Model reported hasDrifted:false but still provided a suggestedSplit — ` +
          `contradictory. Suppressing the split since the "not drifted" verdict takes precedence.`,
      ],
      correctedSplit: null,
    };
  }

  if (hasDrifted && !hasRealSplit) {
    return {
      warnings: [
        `Model reported hasDrifted:true but provided no suggestedSplit — a drift verdict ` +
          `without an actionable plan. Consider re-running this file.`,
      ],
      correctedSplit: suggestedSplit,
    };
  }

  return { warnings: [], correctedSplit: suggestedSplit };
}

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
 * model). Two distinct failure modes get different treatment:
 *
 * 1. The symbol is IMPORTED into this file from elsewhere, not
 *    defined here at all. This is a more serious confusion than #2 —
 *    the model is suggesting to "move" code that isn't this file's
 *    own logic in the first place (e.g. it saw `import { analyzeDrift }
 *    from "../analyze-drift"` used in this file and suggested moving
 *    analyzeDrift out of THIS file, when it was never here).
 * 2. The symbol matches neither an export nor an import — most likely
 *    a real but unexported local helper the model noticed while
 *    reading. Lower-severity: it's this file's own code, just not
 *    exported yet.
 *
 * For files with zero real exports (common — e.g. closures with no
 * module-level exports), every suggested symbol is by definition
 * unverifiable, so we give one summary warning instead of spamming
 * one line per symbol.
 */
function findUnknownSymbolWarnings(
  suggestedSplit: DriftAnalysis["suggestedSplit"],
  actualExportedSymbols: string[],
  importedSymbolNames: string[]
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
  const importedSet = new Set(importedSymbolNames);

  const importedNotDefined = new Set<string>();
  const unverifiedLocal = new Set<string>();

  for (const entry of suggestedSplit) {
    for (const symbol of entry.movedExports) {
      if (actualSet.has(symbol)) continue;

      if (importedSet.has(symbol)) {
        importedNotDefined.add(symbol);
      } else {
        unverifiedLocal.add(symbol);
      }
    }
  }

  const warnings: string[] = [];

  if (importedNotDefined.size > 0) {
    warnings.push(
      `${importedNotDefined.size} suggested symbol(s) are IMPORTED into this file from ` +
        `elsewhere, not defined here — this file doesn't actually own this code, so it ` +
        `can't be "moved" out of it: ${[...importedNotDefined].join(", ")}.`
    );
  }

  if (unverifiedLocal.size > 0) {
    warnings.push(
      `${unverifiedLocal.size} suggested symbol(s) don't match this file's actual exports and ` +
        `may be unexported internal names: ${[...unverifiedLocal].join(", ")}.`
    );
  }

  return warnings;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "and", "for", "in", "on", "with", "from",
  "by", "as", "is", "are", "this", "that", "it", "its", "or", "not",
  "including", "based", "into", "their", "these", "such", "handling",
]);

function significantTokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(words.filter((w) => w.length > 2 && !STOPWORDS.has(w)));
}

/**
 * Heuristic, word-overlap based — NOT a verified fact the way the
 * export/import checks are, and the warning text says so explicitly.
 * Real bug this catches: the model's prose in currentResponsibilities
 * can describe something that its own suggestedSplit never actually
 * addresses anywhere — e.g. a file named "notification-service.ts"
 * whose stated responsibility talks about database transactions,
 * while "sending setup notifications" (a real currentResponsibilities
 * item) isn't covered by ANY suggested file's description at all.
 * That's the model scrambling its own labels, not just an unverified
 * symbol — a different failure mode from anything checked so far.
 */
function findUnaddressedResponsibilityWarnings(
  currentResponsibilities: string[],
  suggestedSplit: DriftAnalysis["suggestedSplit"]
): string[] {
  if (!suggestedSplit || suggestedSplit.length === 0) return [];
  if (!Array.isArray(currentResponsibilities) || currentResponsibilities.length === 0) return [];

  const splitTokenPool = new Set<string>();
  for (const entry of suggestedSplit) {
    for (const t of significantTokens(entry.responsibility ?? "")) {
      splitTokenPool.add(t);
    }
  }

  const unaddressed: string[] = [];
  for (const responsibility of currentResponsibilities) {
    const tokens = significantTokens(responsibility);
    if (tokens.size === 0) continue; // nothing meaningful to check
    const hasAnyOverlap = [...tokens].some((t) => splitTokenPool.has(t));
    if (!hasAnyOverlap) {
      unaddressed.push(responsibility);
    }
  }

  if (unaddressed.length === 0) return [];

  return [
    `Possible description mismatch (heuristic, word-overlap check — not verified): ` +
      `the analysis says this file is responsible for "${unaddressed.join('", "')}", but no file ` +
      `in the suggested split describes anything related to that — the split may be incomplete ` +
      `or a file's stated responsibility may not match its real content.`,
  ];
}

export function validateDriftAnalysis(
  parsed: any,
  rawText: string,
  actualExportedSymbols: string[],
  importedSymbolNames: string[]
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
  const consistency = checkConsistency(parsed.hasDrifted, suggestedSplit);

  return {
    inferredOriginalPurpose: parsed.inferredOriginalPurpose,
    currentResponsibilities: parsed.currentResponsibilities,
    hasDrifted: parsed.hasDrifted,
    driftSummary: parsed.driftSummary,
    suggestedSplit: consistency.correctedSplit,
    warnings: [
      ...consistency.warnings,
      ...findUnaddressedResponsibilityWarnings(parsed.currentResponsibilities, consistency.correctedSplit),
      ...findDuplicateSymbolWarnings(consistency.correctedSplit),
      ...findUnknownSymbolWarnings(consistency.correctedSplit, actualExportedSymbols, importedSymbolNames),
    ],
  };
}
