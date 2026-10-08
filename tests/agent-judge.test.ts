import { describe, it, expect } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {
  buildEmittedPrompts,
  emitPromptsToDirectory,
  evaluateExternalAnalysis,
} from "../src/analyze-drift";
import type { ScoredFileMetrics } from "../src/scoring";
import type { RepoFileMetrics } from "../src/scan-repo";

describe("agent-as-the-judge — buildEmittedPrompts", () => {
  it("constructs system and user prompts for outlier files", () => {
    const tmpDir = path.join(os.tmpdir(), `cambium-emitted-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    const filePath = path.join(tmpDir, "src/worker.ts");
    fs.writeFileSync(
      filePath,
      `export function doWork() { return 1; }\nexport function parseWork() { return 2; }`
    );

    const mockOutlier: ScoredFileMetrics = {
      filePath,
      lines: 2,
      cyclomaticComplexity: 2,
      exportedSymbols: ["doWork", "parseWork"],
      importCount: 0,
      importedFrom: [],
      importedSymbolNames: [],
      hasSyntaxErrors: false,
      fanIn: 1,
      touchCount: 5,
    };

    try {
      const emitted = buildEmittedPrompts([mockOutlier], tmpDir);
      expect(emitted).toHaveLength(1);
      const prompt = emitted[0];

      expect(prompt.relativeFilePath).toBe("src/worker.ts");
      expect(prompt.exportedSymbols).toEqual(["doWork", "parseWork"]);
      expect(prompt.touchCount).toBe(5);
      expect(prompt.systemPrompt).toContain("senior software architect");
      expect(prompt.userPrompt).toContain("Git touch count: 5 commit(s)");
      expect(prompt.userPrompt).toContain("export function doWork()");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("agent-as-the-judge — emitPromptsToDirectory", () => {
  it("writes markdown prompt files to target directory", () => {
    const tmpDir = path.join(os.tmpdir(), `cambium-prompts-dir-${Date.now()}`);
    const outDir = path.join(tmpDir, "prompts");

    const samplePrompt = {
      filePath: "/root/src/service.ts",
      relativeFilePath: "src/service.ts",
      exportedSymbols: ["Service"],
      importedSymbolNames: ["fetch"],
      touchCount: 3,
      systemPrompt: "System instruction here",
      userPrompt: "User prompt with source code",
    };

    try {
      const written = emitPromptsToDirectory([samplePrompt], outDir);
      expect(written).toHaveLength(1);
      expect(fs.existsSync(written[0])).toBe(true);

      const content = fs.readFileSync(written[0], "utf-8");
      expect(content).toContain("Cambium Drift Analysis Prompt: src/service.ts");
      expect(content).toContain("System instruction here");
      expect(content).toContain("User prompt with source code");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("agent-as-the-judge — evaluateExternalAnalysis", () => {
  it("validates external evaluation and catches hallucinated exports", () => {
    const mockRepoFiles: RepoFileMetrics[] = [
      {
        filePath: "/root/src/module.ts",
        lines: 100,
        cyclomaticComplexity: 10,
        exportedSymbols: ["realExportA", "realExportB"],
        importCount: 1,
        importedFrom: ["./dep"],
        importedSymbolNames: ["depHelper"],
        hasSyntaxErrors: false,
        fanIn: 2,
      },
    ];

    const externalPayload = [
      {
        filePath: "src/module.ts",
        inferredOriginalPurpose: "Worker module",
        currentResponsibilities: ["Handling tasks", "Reporting"],
        hasDrifted: true,
        driftSummary: "File has accumulated reporting responsibilities.",
        suggestedSplit: [
          {
            newFileName: "src/reporter.ts",
            responsibility: "Reporting",
            // Notice: fakeExport does NOT exist in real module!
            movedExports: ["realExportB", "hallucinatedExport"],
          },
        ],
      },
    ];

    const results = evaluateExternalAnalysis(externalPayload, mockRepoFiles, "/root");
    expect(results).toHaveLength(1);
    const analysis = results[0];

    expect(analysis.hasDrifted).toBe(true);
    expect(analysis.driftSummary).toContain("reporting responsibilities");
    // Cambium guardrails must catch hallucinatedExport in warnings!
    expect(analysis.warnings.length).toBeGreaterThan(0);
    expect(analysis.warnings.some((w) => w.includes("hallucinatedExport"))).toBe(true);
  });
});
