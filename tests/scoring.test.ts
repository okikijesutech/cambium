import { describe, it, expect } from "vitest";
import { computeOutlierScore, attachTouchFrequency } from "../src/scoring";
import { RepoFileMetrics } from "../src/scan-repo";

function makeMetrics(overrides: Partial<RepoFileMetrics>): RepoFileMetrics {
  return {
    filePath: "/repo/src/example.ts",
    lines: 100,
    cyclomaticComplexity: 10,
    exportedSymbols: [],
    importCount: 0,
    importedFrom: [],
    importedSymbolNames: [],
    hasSyntaxErrors: false,
    fanIn: 2,
    ...overrides,
  };
}

describe("computeOutlierScore", () => {
  it("weights complexity, lines, fanIn, and touches per the documented formula", () => {
    const m = { ...makeMetrics({ lines: 100, cyclomaticComplexity: 10, fanIn: 2 }), touchCount: 5 };
    // complexity*2 + lines*0.1 + fanIn*3 + touches*2 = 20 + 10 + 6 + 10 = 46
    expect(computeOutlierScore(m)).toBe(46);
  });

  it("contributes zero from touches when touchCount is null (no git history)", () => {
    const m = { ...makeMetrics({ lines: 100, cyclomaticComplexity: 10, fanIn: 2 }), touchCount: null };
    // complexity*2 + lines*0.1 + fanIn*3 = 20 + 10 + 6 = 36
    expect(computeOutlierScore(m)).toBe(36);
  });
});

describe("attachTouchFrequency", () => {
  it("attaches null touchCount for every file when no git history is available", () => {
    const results = [makeMetrics({ filePath: "/repo/a.ts" }), makeMetrics({ filePath: "/repo/b.ts" })];
    const scored = attachTouchFrequency(results, null);
    expect(scored.every((m) => m.touchCount === null)).toBe(true);
  });

  it("attaches the correct count for files present in the touch-frequency map", () => {
    const results = [makeMetrics({ filePath: "/repo/a.ts" })];
    const touchMap = new Map([["/repo/a.ts", 7]]);
    const scored = attachTouchFrequency(results, touchMap);
    expect(scored[0].touchCount).toBe(7);
  });

  it("defaults to 0 (not null) for a file with git history available but zero commits touching it", () => {
    const results = [makeMetrics({ filePath: "/repo/untouched.ts" })];
    const touchMap = new Map<string, number>(); // real history, this file just has no entries
    const scored = attachTouchFrequency(results, touchMap);
    expect(scored[0].touchCount).toBe(0);
  });
});
