import { describe, it, expect } from "vitest";
import * as path from "path";
import { buildScanJsonReport } from "../src/commands/scan";
import type { ScoredFileMetrics } from "../src/scoring";
import type { Baseline } from "../src/baseline";

describe("buildScanJsonReport — machine-readable JSON output", () => {
  const fakeRepo = path.resolve("/test/repo");

  const sampleMetrics: ScoredFileMetrics[] = [
    {
      filePath: path.join(fakeRepo, "src/god-module.ts"),
      lines: 500,
      cyclomaticComplexity: 45,
      fanIn: 3,
      exportedSymbols: ["funcA", "funcB"],
      hasSyntaxErrors: false,
      touchCount: 12
    },
    {
      filePath: path.join(fakeRepo, "src/small.ts"),
      lines: 50,
      cyclomaticComplexity: 2,
      fanIn: 1,
      exportedSymbols: ["small"],
      hasSyntaxErrors: false,
      touchCount: 2
    }
  ];

  it("produces valid structured JSON report without baseline", () => {
    const report = buildScanJsonReport(sampleMetrics, 10, fakeRepo, null);

    expect(report.scannedFiles).toBe(2);
    expect(report.outliersCount).toBe(2);
    expect(report.limit).toBe(10);
    expect(report.hasGitHistory).toBe(true);
    expect(report.hasSyntaxErrors).toBe(false);
    expect(report.syntaxErrorsCount).toBe(0);
    expect(report.baseline).toBeNull();

    expect(report.outliers).toHaveLength(2);
    const top = report.outliers[0];
    expect(top.relativeFilePath).toBe("src/god-module.ts");
    expect(top.cyclomaticComplexity).toBe(45);
    expect(top.lines).toBe(500);
    expect(top.fanIn).toBe(3);
    expect(top.touches).toBe(12);
    expect(top.exports).toBe(2);
    expect(top.exportedSymbols).toEqual(["funcA", "funcB"]);
    expect(top.delta).toBeNull();
    expect(top.score).toBeGreaterThan(report.outliers[1].score);
  });

  it("calculates baseline deltas when baseline is provided", () => {
    const fakeBaseline: Baseline = {
      createdAt: "2026-10-01T00:00:00.000Z",
      repoPath: fakeRepo,
      files: {
        "src/god-module.ts": {
          lines: 600,
          cyclomaticComplexity: 55,
          fanIn: 3,
          exportedSymbols: ["funcA"]
        }
      }
    };

    const report = buildScanJsonReport(sampleMetrics, 10, fakeRepo, fakeBaseline);

    expect(report.baseline).not.toBeNull();
    expect(report.baseline?.createdAt).toBe("2026-10-01T00:00:00.000Z");

    const top = report.outliers[0];
    expect(top.delta).toEqual({
      isNew: false,
      complexityDelta: -10,
      linesDelta: -100
    });

    const second = report.outliers[1];
    expect(second.delta).toEqual({
      isNew: true,
      complexityDelta: 0,
      linesDelta: 0
    });
  });

  it("respects the limit parameter to cap top outliers", () => {
    const report = buildScanJsonReport(sampleMetrics, 1, fakeRepo, null);
    expect(report.scannedFiles).toBe(2);
    expect(report.outliersCount).toBe(1);
    expect(report.outliers).toHaveLength(1);
    expect(report.outliers[0].relativeFilePath).toBe("src/god-module.ts");
  });
});
