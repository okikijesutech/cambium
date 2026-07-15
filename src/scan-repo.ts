import { Project } from "ts-morph";
import * as path from "path";
import { computeFileMetrics, FileMetrics } from "./metrics";

export interface RepoFileMetrics extends FileMetrics {
  fanIn: number; // how many other files in the repo import from this one
}

const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.d.ts",
];

/**
 * Walk a repo root, parse every .ts/.tsx file into one shared ts-morph
 * Project (needed so fan-in resolution can see the whole module graph),
 * and return per-file metrics including fan-in.
 */
export function scanRepo(repoRoot: string): RepoFileMetrics[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
  });

  const globPattern = path.join(repoRoot, "**/*.{ts,tsx}").replace(/\\/g, "/");
  project.addSourceFilesAtPaths([
    globPattern,
    ...DEFAULT_IGNORE.map((p) => `!${path.join(repoRoot, p).replace(/\\/g, "/")}`),
  ]);

  const sourceFiles = project.getSourceFiles();

  // Build fan-in counts: for each file, how many OTHER files
  // resolve an import to it.
  const fanInCounts = new Map<string, number>();
  for (const sf of sourceFiles) {
    fanInCounts.set(sf.getFilePath(), 0);
  }

  for (const sf of sourceFiles) {
    const importedFiles = new Set<string>();

    for (const importDecl of sf.getImportDeclarations()) {
      const resolved = importDecl.getModuleSpecifierSourceFile();
      if (resolved && resolved.getFilePath() !== sf.getFilePath()) {
        importedFiles.add(resolved.getFilePath());
      }
    }

    for (const filePath of importedFiles) {
      fanInCounts.set(filePath, (fanInCounts.get(filePath) ?? 0) + 1);
    }
  }

  const results: RepoFileMetrics[] = [];

  for (const sf of sourceFiles) {
    const filePath = sf.getFilePath();
    const base = computeFileMetrics(project, filePath);

    results.push({
      ...base,
      fanIn: fanInCounts.get(filePath) ?? 0,
    });
  }

  return results;
}
