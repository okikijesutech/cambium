import { Project, SourceFile, SyntaxKind, Node } from "ts-morph";

export interface FileMetrics {
  filePath: string;
  lines: number;
  cyclomaticComplexity: number;
  exportedSymbols: string[];
  importCount: number;
  importedFrom: string[]; // module specifiers this file imports from
  importedSymbolNames: string[]; // named symbols imported INTO this file from elsewhere
  hasSyntaxErrors: boolean; // true if the file doesn't actually parse as valid TS —
                            // all other numbers on this file are unreliable when true
}

/**
 * Cyclomatic complexity for any AST node or subtree (Function, Method, or SourceFile).
 * Starts at 1, adds 1 for every branch/decision point:
 * if, for, while, do-while, case, catch, ternary, and logical && / || / ??.
 */
export function computeNodeComplexity(node: Node): number {
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

  node.forEachDescendant((child) => {
    const kind = child.getKind();

    if (branchKinds.has(kind)) {
      complexity++;
      return;
    }

    // Logical && / || / ?? each add a decision point
    if (Node.isBinaryExpression(child)) {
      const op = child.getOperatorToken().getKind();
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

/**
 * Cyclomatic complexity, computed the standard way:
 * start at 1, add 1 for every branch/decision point in the file.
 *
 * This is a whole-file complexity score (sum across all functions),
 * which is what we want for "is this file doing too much" rather
 * than per-function complexity.
 */
function computeCyclomaticComplexity(sourceFile: SourceFile): number {
  return computeNodeComplexity(sourceFile);
}

/**
 * TypeScript's parser is deliberately error-tolerant — it always
 * produces SOME AST even from genuinely broken code, which means
 * every other metric in this file (complexity, exports, imports)
 * would otherwise be silently computed from garbage with zero
 * indication anything was wrong. This checks SYNTAX-only diagnostics
 * (not semantic/type diagnostics — those fire constantly on valid
 * code parsed without full project type context, e.g. "cannot find
 * name 'path'", and would be false positives here).
 */
function hasSyntaxErrors(project: Project, sourceFile: SourceFile): boolean {
  const program = project.getProgram().compilerObject;
  const syntaxDiagnostics = program.getSyntacticDiagnostics(sourceFile.compilerNode);
  return syntaxDiagnostics.length > 0;
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
  importedSymbolNames: string[];
} {
  const importDecls = sourceFile.getImportDeclarations();
  const importedFrom = importDecls.map((d) => d.getModuleSpecifierValue());

  const importedSymbolNames: string[] = [];
  for (const decl of importDecls) {
    for (const named of decl.getNamedImports()) {
      importedSymbolNames.push(named.getName());
    }
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) importedSymbolNames.push(defaultImport.getText());
    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) importedSymbolNames.push(namespaceImport.getText());
  }

  return {
    importCount: importDecls.length,
    importedFrom,
    importedSymbolNames,
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

  const { importCount, importedFrom, importedSymbolNames } = getImportInfo(sourceFile);

  return {
    filePath,
    lines: sourceFile.getEndLineNumber(),
    cyclomaticComplexity: computeCyclomaticComplexity(sourceFile),
    exportedSymbols: getExportedSymbols(sourceFile),
    importCount,
    importedFrom,
    importedSymbolNames,
    hasSyntaxErrors: hasSyntaxErrors(project, sourceFile),
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
