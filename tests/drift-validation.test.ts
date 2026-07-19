import { describe, it, expect } from "vitest";
import { validateDriftAnalysis } from "../src/drift-validation";

function makeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    inferredOriginalPurpose: "test purpose",
    currentResponsibilities: ["a", "b"],
    hasDrifted: true,
    driftSummary: "test summary",
    suggestedSplit: null,
    ...overrides,
  };
}

describe("validateDriftAnalysis — duplicate symbol detection", () => {
  it("flags the same symbol appearing in two suggested files (real popup.ts case)", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "popup-ui.ts", responsibility: "UI", movedExports: ["loginBtn", "syncBtn"] },
        { newFileName: "popup-logic.ts", responsibility: "Logic", movedExports: ["loginBtn", "syncBtn"] },
      ],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings.some((w) => w.includes("loginBtn"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("syncBtn"))).toBe(true);
  });

  it("does not warn when every symbol appears in exactly one file", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "a.ts", responsibility: "A", movedExports: ["x"] },
        { newFileName: "b.ts", responsibility: "B", movedExports: ["y"] },
      ],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["x", "y"], []);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validateDriftAnalysis — imported vs unexported symbols (real drift.ts case)", () => {
  it("distinguishes imported symbols from unexported local ones", () => {
    const parsed = makeResponse({
      suggestedSplit: [
        { newFileName: "drift-analysis.ts", responsibility: "x", movedExports: ["resolveProvider", "analyzeDrift"] },
        { newFileName: "result-formatting.ts", responsibility: "y", movedExports: ["formatDriftReportMarkdown"] },
      ],
    });
    const importedSymbolNames = ["analyzeDrift", "formatDriftReportMarkdown", "scanRepo"];
    const result = validateDriftAnalysis(
      parsed,
      JSON.stringify(parsed),
      ["registerDriftCommand"],
      importedSymbolNames
    );

    const importedWarning = result.warnings.find((w) => w.includes("IMPORTED"));
    expect(importedWarning).toBeDefined();
    expect(importedWarning).toContain("analyzeDrift");
    expect(importedWarning).toContain("formatDriftReportMarkdown");
    expect(importedWarning).not.toContain("resolveProvider");

    const localWarning = result.warnings.find((w) => w.includes("unexported internal"));
    expect(localWarning).toBeDefined();
    expect(localWarning).toContain("resolveProvider");
  });

  it("gives one summary warning, not one per symbol, when a file has zero real exports", () => {
    const parsed = makeResponse({
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "x", movedExports: ["foo", "bar"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), [], []);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("no real exported symbols");
  });
});

describe("validateDriftAnalysis — internal consistency (hasDrifted vs suggestedSplit)", () => {
  it("suppresses a suggestedSplit when hasDrifted is false (contradictory)", () => {
    const parsed = makeResponse({
      hasDrifted: false,
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "a", movedExports: ["a"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.suggestedSplit).toBeNull();
    expect(result.warnings.some((w) => w.includes("contradictory"))).toBe(true);
  });

  it("warns without fabricating a split when hasDrifted is true but no split given", () => {
    const parsed = makeResponse({ hasDrifted: true, suggestedSplit: null });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.suggestedSplit).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("produces zero warnings for a normal, consistent response", () => {
    const parsed = makeResponse({
      hasDrifted: true,
      suggestedSplit: [{ newFileName: "a.ts", responsibility: "a", movedExports: ["a"] }],
    });
    const result = validateDriftAnalysis(parsed, JSON.stringify(parsed), ["a"], []);
    expect(result.warnings).toHaveLength(0);
  });
});

describe("validateDriftAnalysis — malformed responses fail loudly", () => {
  it("throws when required fields are missing, rather than silently returning partial data", () => {
    const broken = { inferredOriginalPurpose: "x" };
    expect(() => validateDriftAnalysis(broken, JSON.stringify(broken), [], [])).toThrow();
  });
});
