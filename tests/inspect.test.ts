import { describe, it, expect, beforeEach } from "vitest";
import { Project } from "ts-morph";
import {
  extractFunctionsFromSourceFile,
  inspectSourceFile,
  FileInspectionReport,
} from "../src/inspect";
import { formatInspectTable } from "../src/commands/inspect";

describe("inspect — function-level cyclomatic complexity extraction", () => {
  let project: Project;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
  });

  it("extracts named functions and computes their complexity and line ranges", () => {
    const code = `
      export function complexFunction(x: number, y: number) {
        if (x > 0 && y > 0) {
          for (let i = 0; i < x; i++) {
            if (i % 2 === 0) {
              console.log(i);
            }
          }
        } else if (x < 0) {
          return -1;
        }
        return 0;
      }

      function simpleHelper() {
        return 42;
      }
    `;

    const sf = project.createSourceFile("/complex.ts", code);
    const funcs = extractFunctionsFromSourceFile(sf);

    expect(funcs.length).toBe(2);

    const complexFn = funcs[0];
    expect(complexFn.name).toBe("complexFunction");
    expect(complexFn.kind).toBe("function");
    expect(complexFn.isExported).toBe(true);
    // Base 1 + if(1) + &&(1) + for(1) + if(1) + else-if(1) = 6
    expect(complexFn.cyclomaticComplexity).toBe(6);
    expect(complexFn.lines).toBe(12);

    const helperFn = funcs[1];
    expect(helperFn.name).toBe("simpleHelper");
    expect(helperFn.kind).toBe("function");
    expect(helperFn.isExported).toBe(false);
    expect(helperFn.cyclomaticComplexity).toBe(1);
    expect(helperFn.lines).toBe(3);
  });

  it("extracts class methods, constructors, and accessors with ClassName prefix", () => {
    const code = `
      export class OrderManager {
        private status = "pending";

        constructor(id: string) {
          if (!id) throw new Error("ID required");
        }

        public processOrder(amount: number) {
          if (amount <= 0) return false;
          if (this.status !== "pending") return false;
          return true;
        }

        get isPending() {
          return this.status === "pending";
        }
      }
    `;

    const sf = project.createSourceFile("/class.ts", code);
    const funcs = extractFunctionsFromSourceFile(sf);

    const names = funcs.map((f) => f.name);
    expect(names).toContain("OrderManager.constructor");
    expect(names).toContain("OrderManager.processOrder");
    expect(names).toContain("OrderManager.get isPending");

    const method = funcs.find((f) => f.name === "OrderManager.processOrder")!;
    expect(method.kind).toBe("method");
    expect(method.cyclomaticComplexity).toBe(3); // base 1 + 2 ifs
    expect(method.isExported).toBe(true);

    const ctor = funcs.find((f) => f.name === "OrderManager.constructor")!;
    expect(ctor.kind).toBe("constructor");
    expect(ctor.cyclomaticComplexity).toBe(2); // base 1 + 1 if
  });

  it("extracts exported arrow functions assigned to const", () => {
    const code = `
      export const validateUser = (user: any) => {
        if (!user) return false;
        return user.age >= 18 ? true : false;
      };
    `;

    const sf = project.createSourceFile("/arrow.ts", code);
    const funcs = extractFunctionsFromSourceFile(sf);

    expect(funcs.length).toBe(1);
    const arrowFn = funcs[0];
    expect(arrowFn.name).toBe("validateUser");
    expect(arrowFn.kind).toBe("arrow");
    expect(arrowFn.isExported).toBe(true);
    expect(arrowFn.cyclomaticComplexity).toBe(3); // base 1 + if + ternary
  });

  it("skips trivial 1-line lambdas but captures complex callbacks", () => {
    const code = `
      export function runTasks(items: number[]) {
        // Trivial 1-line lambda (should NOT clutter inspection)
        const doubled = items.map((x) => x * 2);

        // Substantial callback with branching logic (should be captured)
        items.forEach((item) => {
          if (item > 10) {
            console.log("High:", item);
          } else {
            console.log("Low:", item);
          }
        });

        return doubled;
      }
    `;

    const sf = project.createSourceFile("/callbacks.ts", code);
    const funcs = extractFunctionsFromSourceFile(sf);

    const names = funcs.map((f) => f.name);
    expect(names).toContain("runTasks");
    expect(names).toContain("items.forEach callback");
    expect(names).not.toContain("items.map callback");
  });

  it("produces full FileInspectionReport with relative paths and metrics", () => {
    const code = `
      import { something } from "./other";
      export function action(flag: boolean) {
        if (flag) return something();
        return null;
      }
    `;

    const sf = project.createSourceFile("/root/src/module.ts", code);
    const report = inspectSourceFile(project, sf, "/root");

    expect(report.filePath).toBe("/root/src/module.ts");
    expect(report.relativeFilePath).toBe("src/module.ts");
    expect(report.lines).toBe(7);
    expect(report.cyclomaticComplexity).toBe(2);
    expect(report.exportedSymbols).toEqual(["action"]);
    expect(report.importCount).toBe(1);
    expect(report.functionsCount).toBe(1);
    expect(report.functions[0].name).toBe("action");
  });
});

describe("formatInspectTable — human-readable output formatting", () => {
  it("formats table with columns and respects limit", () => {
    const sampleReport: FileInspectionReport = {
      filePath: "/test/file.ts",
      relativeFilePath: "src/file.ts",
      lines: 200,
      cyclomaticComplexity: 25,
      exportedSymbols: ["funcA", "funcB"],
      importCount: 5,
      hasSyntaxErrors: false,
      functionsCount: 2,
      functions: [
        {
          name: "hugeHandler",
          kind: "function",
          startLine: 10,
          endLine: 120,
          lines: 111,
          cyclomaticComplexity: 18,
          isExported: true,
        },
        {
          name: "smallHandler",
          kind: "arrow",
          startLine: 130,
          endLine: 150,
          lines: 21,
          cyclomaticComplexity: 4,
          isExported: false,
        },
      ],
    };

    const table = formatInspectTable(sampleReport, 1);
    expect(table).toContain("Inspecting: src/file.ts");
    expect(table).toContain("Total Complexity: 25");
    expect(table).toContain("hugeHandler");
    expect(table).not.toContain("smallHandler"); // limit was 1
    expect(table).toContain("L10-L120");
  });

  it("handles files with zero functions gracefully", () => {
    const emptyReport: FileInspectionReport = {
      filePath: "/test/types.ts",
      relativeFilePath: "src/types.ts",
      lines: 50,
      cyclomaticComplexity: 1,
      exportedSymbols: ["User"],
      importCount: 0,
      hasSyntaxErrors: false,
      functionsCount: 0,
      functions: [],
    };

    const table = formatInspectTable(emptyReport, 10);
    expect(table).toContain("No functions or methods detected in this file.");
  });
});
