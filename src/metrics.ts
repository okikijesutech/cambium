import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";

export interface FileMetrics {
  filePath: string;
  lines: number;
  cyclomaticComplexity: number;
  exportedSymbols: string[];
  importCount: number;
  importedFrom: string[]; // module specifiers this file imports from
}

/**
 * Cyclomatic complexity, computed the standard way:
 * start at 1, add 1 for every branch/decision point in the file.
 * Branch points: if, for, while, do-while, case, catch, ternary,
 * logical && / ||, and optional chaining (?.) with a fallback.
 *
 * This is a whole-file complexity score (sum across all functions),
 * which is what we want for "is this file doing too much" rather
 * than per-function complexity.
 */
function computeCyclomaticComplexity(sourceFile: SourceFile): number {
  let complexity = 1;

  const branchKinds = new Set([
    SyntaxKind.IfStatement,
    SyntaxKind.ForStatement,
    SyntaxKind.ForInStatement,
    SyntaxKind.ForOfStatement,
    SyntaxKind.WhileStatement,
    SyntaxKind.DoStatement,
    SyntaxKind.CaseClause,
    SyntaxKind.CatchClause,
    SyntaxKind.ConditionalExpression, // ternary
  ]);

  sourceFile.forEachDescendant((node) => {
    const kind = node.getKind();

    if (branchKinds.has(kind)) {
      complexity++;
      return;
    }

    // Logical && / || each add a decision point
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      if (
        op === SyntaxKind.AmpersandAmpersandToken ||
        op === SyntaxKind.BarBarToken ||
        op === SyntaxKind.QuestionQuestionToken
      ) {
        complexity++;
      }
    }
  });

  return complexity;
}

function getExportedSymbols(sourceFile: SourceFile): string[] {
  const names: string[] = [];

  for (const [name] of sourceFile.getExportedDeclarations()) {
    names.push(name);
  }

  return names;
}

function getImportInfo(sourceFile: SourceFile): {
  importCount: number;
  importedFrom: string[];
} {
  const importDecls = sourceFile.getImportDeclarations();
  const importedFrom = importDecls.map((d) => d.getModuleSpecifierValue());

  return {
    importCount: importDecls.length,
    importedFrom,
  };
}

/**
 * Compute metrics for a single file. Pass in a Project so callers
 * building whole-repo metrics (fan-in etc.) can reuse one parsed
 * project instead of re-parsing per file.
 */
export function computeFileMetrics(
  project: Project,
  filePath: string
): FileMetrics {
  const sourceFile = project.getSourceFileOrThrow(filePath);

  const { importCount, importedFrom } = getImportInfo(sourceFile);

  return {
    filePath,
    lines: sourceFile.getEndLineNumber(),
    cyclomaticComplexity: computeCyclomaticComplexity(sourceFile),
    exportedSymbols: getExportedSymbols(sourceFile),
    importCount,
    importedFrom,
  };
}

/**
 * Convenience for testing a single file in isolation without
 * building a full-repo Project first.
 */
export function computeMetricsForSingleFile(filePath: string): FileMetrics {
  const project = new Project();
  project.addSourceFileAtPath(filePath);
  return computeFileMetrics(project, filePath);
}
