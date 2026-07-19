import { describe, it, expect, beforeEach } from "vitest";
import { Project } from "ts-morph";
import { computeFileMetrics } from "../src/metrics";

function metricsForSource(project: Project, filePath: string, source: string) {
  project.createSourceFile(filePath, source, { overwrite: true });
  return computeFileMetrics(project, filePath);
}

describe("computeFileMetrics — syntax error detection", () => {
  let project: Project;
  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it("flags a genuinely broken file (real repro from the stress test)", () => {
    const broken = `export function broken( {\n  if (true {\n    console.log("unterminated`;
    const m = metricsForSource(project, "/broken.ts", broken);
    expect(m.hasSyntaxErrors).toBe(true);
  });

  it("does not flag a valid file merely missing full type context (must not false-positive)", () => {
    // This mirrors the real false positive found: a file using Node
    // globals without @types/node in scope triggers SEMANTIC
    // diagnostics, which must not be confused with SYNTAX errors.
    const valid = `export function usesPath(p: string) { return p.length; }`;
    const m = metricsForSource(project, "/valid.ts", valid);
    expect(m.hasSyntaxErrors).toBe(false);
  });
});

describe("computeFileMetrics — cyclomatic complexity", () => {
  let project: Project;
  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it("counts branch points correctly on a simple function", () => {
    const source = `export function f(x: number) {
      if (x > 0) { return 1; }
      return 0;
    }`;
    const m = metricsForSource(project, "/simple.ts", source);
    expect(m.cyclomaticComplexity).toBe(2); // base 1 + 1 if
  });

  it("counts a function with no branches as complexity 1", () => {
    const source = `export function f(x: number) { return x + 1; }`;
    const m = metricsForSource(project, "/flat.ts", source);
    expect(m.cyclomaticComplexity).toBe(1);
  });
});

describe("computeFileMetrics — imported symbol tracking", () => {
  let project: Project;
  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it("distinguishes imported symbols from locally-defined ones", () => {
    const source = `
      import { foo, bar } from "./other";
      function localHelper() { return foo() + bar(); }
      export function main() { return localHelper(); }
    `;
    const m = metricsForSource(project, "/importer.ts", source);
    expect(m.importedSymbolNames).toContain("foo");
    expect(m.importedSymbolNames).toContain("bar");
    expect(m.importedSymbolNames).not.toContain("localHelper");
    expect(m.exportedSymbols).toContain("main");
    expect(m.exportedSymbols).not.toContain("localHelper");
  });
});
