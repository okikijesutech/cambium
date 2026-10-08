import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";
import * as path from "path";
import { computeFileMetrics, computeNodeComplexity } from "./metrics";
import { toForwardSlashes } from "./git-paths";

export interface InspectedFunction {
  name: string;
  kind: "function" | "method" | "constructor" | "getter" | "setter" | "arrow" | "callback";
  startLine: number;
  endLine: number;
  lines: number;
  cyclomaticComplexity: number;
  isExported: boolean;
}

export interface FileInspectionReport {
  filePath: string;
  relativeFilePath: string;
  lines: number;
  cyclomaticComplexity: number;
  exportedSymbols: string[];
  importCount: number;
  hasSyntaxErrors: boolean;
  functionsCount: number;
  functions: InspectedFunction[];
}

function getParentScopeName(node: Node): string | null {
  let curr = node.getParent();
  while (curr) {
    if (Node.isClassDeclaration(curr)) return curr.getName() || "AnonymousClass";
    if (Node.isFunctionDeclaration(curr)) return curr.getName() || "anonymous";
    if (Node.isVariableDeclaration(curr)) return curr.getName();
    curr = curr.getParent();
  }
  return null;
}

export function extractFunctionsFromSourceFile(sourceFile: SourceFile): InspectedFunction[] {
  const funcs: InspectedFunction[] = [];

  sourceFile.forEachDescendant((node) => {
    if (Node.isFunctionDeclaration(node)) {
      const parentScope = getParentScopeName(node);
      const rawName = node.getName() || "anonymous";
      const name = parentScope ? `${parentScope} > ${rawName}` : rawName;
      funcs.push({
        name,
        kind: "function",
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        lines: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        cyclomaticComplexity: computeNodeComplexity(node),
        isExported: node.isExported(),
      });
    } else if (Node.isMethodDeclaration(node)) {
      const parent = node.getParent();
      const className = Node.isClassDeclaration(parent) ? parent.getName() : null;
      const name = className ? `${className}.${node.getName()}` : node.getName();
      const isExported = Node.isClassDeclaration(parent) ? parent.isExported() : false;
      funcs.push({
        name,
        kind: "method",
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        lines: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        cyclomaticComplexity: computeNodeComplexity(node),
        isExported,
      });
    } else if (Node.isConstructorDeclaration(node)) {
      const parent = node.getParent();
      const className = Node.isClassDeclaration(parent) ? parent.getName() || "Class" : "Class";
      const isExported = Node.isClassDeclaration(parent) ? parent.isExported() : false;
      funcs.push({
        name: `${className}.constructor`,
        kind: "constructor",
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        lines: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        cyclomaticComplexity: computeNodeComplexity(node),
        isExported,
      });
    } else if (Node.isGetAccessorDeclaration(node) || Node.isSetAccessorDeclaration(node)) {
      const parent = node.getParent();
      const className = Node.isClassDeclaration(parent) ? parent.getName() || "Class" : "Class";
      const isGet = Node.isGetAccessorDeclaration(node);
      const isExported = Node.isClassDeclaration(parent) ? parent.isExported() : false;
      funcs.push({
        name: `${className}.${isGet ? "get" : "set"} ${node.getName()}`,
        kind: isGet ? "getter" : "setter",
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber(),
        lines: node.getEndLineNumber() - node.getStartLineNumber() + 1,
        cyclomaticComplexity: computeNodeComplexity(node),
        isExported,
      });
    } else if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      const complexity = computeNodeComplexity(node);
      const lines = node.getEndLineNumber() - node.getStartLineNumber() + 1;

      if (Node.isVariableDeclaration(parent)) {
        let name = parent.getName();
        const parentScope = getParentScopeName(parent);
        if (parentScope) name = `${parentScope} > ${name}`;
        const stmt = parent.getFirstAncestorByKind(SyntaxKind.VariableStatement);
        funcs.push({
          name,
          kind: Node.isArrowFunction(node) ? "arrow" : "function",
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
          lines,
          cyclomaticComplexity: complexity,
          isExported: stmt?.isExported() ?? false,
        });
      } else if (Node.isPropertyAssignment(parent)) {
        let name = parent.getName();
        const parentScope = getParentScopeName(parent);
        if (parentScope) name = `${parentScope}.${name}`;
        funcs.push({
          name,
          kind: Node.isArrowFunction(node) ? "arrow" : "function",
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber(),
          lines,
          cyclomaticComplexity: complexity,
          isExported: false,
        });
      } else if (Node.isCallExpression(parent)) {
        // Non-trivial callback (complexity > 1 or >= 5 lines)
        if (complexity > 1 || lines >= 5) {
          const expr = parent.getExpression();
          let callName = "callback";
          if (Node.isPropertyAccessExpression(expr)) {
            const objText = expr.getExpression().getText().split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
            const shortObj = objText.length > 20 ? objText.slice(-17) : objText;
            callName = shortObj ? `${shortObj}.${expr.getName()} callback` : `${expr.getName()} callback`;
          } else {
            const firstLine = expr.getText().split("\n").map((s) => s.trim()).filter(Boolean)[0] || "";
            const shortExpr = firstLine.length > 25 ? firstLine.slice(0, 22) + "..." : firstLine;
            callName = shortExpr ? `${shortExpr} callback` : "anonymous callback";
          }
          funcs.push({
            name: callName,
            kind: "callback",
            startLine: node.getStartLineNumber(),
            endLine: node.getEndLineNumber(),
            lines,
            cyclomaticComplexity: complexity,
            isExported: false,
          });
        }
      } else {
        if (complexity > 1 || lines >= 5) {
          funcs.push({
            name: "anonymous",
            kind: Node.isArrowFunction(node) ? "arrow" : "function",
            startLine: node.getStartLineNumber(),
            endLine: node.getEndLineNumber(),
            lines,
            cyclomaticComplexity: complexity,
            isExported: false,
          });
        }
      }
    }
  });

  // Sort descending by complexity, then lines
  funcs.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity || b.lines - a.lines);
  return funcs;
}

export function inspectSourceFile(
  project: Project,
  sourceFile: SourceFile,
  repoPath?: string
): FileInspectionReport {
  const filePath = sourceFile.getFilePath();
  const fileMetrics = computeFileMetrics(project, filePath);
  const functions = extractFunctionsFromSourceFile(sourceFile);

  const baseDir = repoPath ? path.resolve(repoPath) : process.cwd();
  let relativeFilePath = toForwardSlashes(path.relative(baseDir, filePath));
  if (!relativeFilePath || relativeFilePath.startsWith("../")) {
    relativeFilePath = toForwardSlashes(filePath);
  }

  return {
    filePath: toForwardSlashes(filePath),
    relativeFilePath,
    lines: fileMetrics.lines,
    cyclomaticComplexity: fileMetrics.cyclomaticComplexity,
    exportedSymbols: fileMetrics.exportedSymbols,
    importCount: fileMetrics.importCount,
    hasSyntaxErrors: fileMetrics.hasSyntaxErrors,
    functionsCount: functions.length,
    functions,
  };
}

export function inspectFile(filePath: string, repoPath?: string): FileInspectionReport {
  const resolved = path.resolve(filePath);
  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(resolved);
  return inspectSourceFile(project, sourceFile, repoPath);
}
