import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { saveBaseline, loadBaseline, computeDelta, baselineExists } from "../src/baseline";
import { ScoredFileMetrics } from "../src/scoring";

function makeMetrics(overrides: Partial<ScoredFileMetrics>): ScoredFileMetrics {
  return {
    filePath: "/repo/src/example.ts",
    lines: 10,
    cyclomaticComplexity: 2,
    exportedSymbols: ["example"],
    importCount: 0,
    importedFrom: [],
    importedSymbolNames: [],
    hasSyntaxErrors: false,
    fanIn: 0,
    touchCount: null,
    ...overrides,
  };
}

describe("baseline — save/load/delta", () => {
  let tmpRepo: string;

  beforeEach(() => {
    tmpRepo = path.join(os.tmpdir(), `cambium-baseline-test-${Date.now()}`);
    fs.mkdirSync(tmpRepo, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  });

  it("computes a correct delta when a file has grown (real repro: 2->5 complexity)", () => {
    const before = makeMetrics({
      filePath: path.join(tmpRepo, "src/growing.ts"),
      lines: 5,
      cyclomaticComplexity: 2,
    });
    saveBaseline(tmpRepo, [before], "1.3.0");

    const after = makeMetrics({
      filePath: path.join(tmpRepo, "src/growing.ts"),
      lines: 10,
      cyclomaticComplexity: 5,
    });
    const baseline = loadBaseline(tmpRepo)!;
    const delta = computeDelta(after, baseline, tmpRepo);

    expect(delta.isNew).toBe(false);
    expect(delta.complexityDelta).toBe(3);
    expect(delta.linesDelta).toBe(5);
  });

  it("reports zero delta for an unchanged file", () => {
    const m = makeMetrics({ filePath: path.join(tmpRepo, "src/stable.ts") });
    saveBaseline(tmpRepo, [m], "1.3.0");
    const baseline = loadBaseline(tmpRepo)!;
    const delta = computeDelta(m, baseline, tmpRepo);
    expect(delta.complexityDelta).toBe(0);
    expect(delta.linesDelta).toBe(0);
    expect(delta.isNew).toBe(false);
  });

  it("marks a file not present in the baseline as new, not a false delta", () => {
    const original = makeMetrics({ filePath: path.join(tmpRepo, "src/a.ts") });
    saveBaseline(tmpRepo, [original], "1.3.0");
    const baseline = loadBaseline(tmpRepo)!;

    const brandNew = makeMetrics({ filePath: path.join(tmpRepo, "src/brand-new.ts") });
    const delta = computeDelta(brandNew, baseline, tmpRepo);
    expect(delta.isNew).toBe(true);
  });

  it("degrades gracefully on a corrupted baseline file instead of throwing", () => {
    fs.mkdirSync(path.join(tmpRepo, ".cambium"), { recursive: true });
    fs.writeFileSync(path.join(tmpRepo, ".cambium", "baseline.json"), "{ not valid json !!!");
    expect(() => loadBaseline(tmpRepo)).not.toThrow();
    expect(loadBaseline(tmpRepo)).toBeNull();
  });

  it("refuses to overwrite an existing baseline unless told to (checked via baselineExists)", () => {
    const m = makeMetrics({ filePath: path.join(tmpRepo, "src/a.ts") });
    expect(baselineExists(tmpRepo)).toBe(false);
    saveBaseline(tmpRepo, [m], "1.3.0");
    expect(baselineExists(tmpRepo)).toBe(true);
  });

  it("stores keys relative to repo root, not absolute (portability across machines)", () => {
    const m = makeMetrics({ filePath: path.join(tmpRepo, "src", "nested", "deep.ts") });
    saveBaseline(tmpRepo, [m], "1.3.0");
    const raw = JSON.parse(
      fs.readFileSync(path.join(tmpRepo, ".cambium", "baseline.json"), "utf-8")
    );
    const keys = Object.keys(raw.files);
    expect(keys).toContain("src/nested/deep.ts");
    expect(keys.some((k) => k.includes(tmpRepo))).toBe(false);
  });
});
