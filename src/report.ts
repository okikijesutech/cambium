import { RepoFileMetrics } from "./scan-repo";
import { DriftAnalysis } from "./analyze-drift";

function shortPath(filePath: string, segments = 3): string {
  return filePath.split(/[\\/]/).slice(-segments).join("/");
}

function outlierScore(m: { cyclomaticComplexity: number; lines: number; fanIn: number }): number {
  return m.cyclomaticComplexity * 2 + m.lines * 0.1 + m.fanIn * 3;
}

export function formatScanReportMarkdown(
  results: RepoFileMetrics[],
  repoPath: string,
  limit: number
): string {
  const sorted = [...results].sort((a, b) => outlierScore(b) - outlierScore(a));
  const top = sorted.slice(0, limit);
  const timestamp = new Date().toISOString();

  const lines: string[] = [];
  lines.push(`# Cambium Scan Report`);
  lines.push(``);
  lines.push(`- **Repo:** \`${repoPath}\``);
  lines.push(`- **Generated:** ${timestamp}`);
  lines.push(`- **Files scanned:** ${results.length}`);
  lines.push(``);
  lines.push(`| Score | Complexity | Lines | Fan-in | Exports | File |`);
  lines.push(`|---|---|---|---|---|---|`);

  for (const m of top) {
    lines.push(
      `| ${Math.round(outlierScore(m))} | ${m.cyclomaticComplexity} | ${m.lines} | ` +
        `${m.fanIn} | ${m.exportedSymbols.length} | \`${shortPath(m.filePath)}\` |`
    );
  }

  lines.push(``);
  lines.push(
    `*Score = complexity × 2 + lines × 0.1 + fan-in × 3. Higher means more structurally ` +
      `risky — worth a closer look, not necessarily "broken."*`
  );

  return lines.join("\n");
}

export function formatDriftReportMarkdown(
  analyses: DriftAnalysis[],
  repoPath: string
): string {
  const timestamp = new Date().toISOString();
  const drifted = analyses.filter((a) => a.hasDrifted).length;
  const errored = analyses.filter((a) => a.inferredOriginalPurpose === "ERROR").length;

  const lines: string[] = [];
  lines.push(`# Cambium Drift Report`);
  lines.push(``);
  lines.push(`- **Repo:** \`${repoPath}\``);
  lines.push(`- **Generated:** ${timestamp}`);
  lines.push(`- **Files analyzed:** ${analyses.length}`);
  lines.push(`- **Flagged as drifted:** ${drifted}`);
  if (errored > 0) lines.push(`- **Failed:** ${errored}`);
  lines.push(``);

  for (const a of analyses) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## \`${shortPath(a.filePath)}\``);
    lines.push(``);

    if (a.inferredOriginalPurpose === "ERROR") {
      lines.push(`**Analysis failed:** ${a.driftSummary}`);
      lines.push(``);
      continue;
    }

    lines.push(`**Original purpose:** ${a.inferredOriginalPurpose}`);
    lines.push(``);
    lines.push(`**Current responsibilities:**`);
    for (const r of a.currentResponsibilities) lines.push(`- ${r}`);
    lines.push(``);
    lines.push(`**Drifted:** ${a.hasDrifted ? "Yes" : "No"}`);
    lines.push(``);
    lines.push(a.driftSummary);
    lines.push(``);

    if (a.warnings.length > 0) {
      lines.push(`> ⚠ **Warnings — review before acting on this suggestion:**`);
      for (const w of a.warnings) lines.push(`> - ${w}`);
      lines.push(``);
    }

    if (a.suggestedSplit) {
      lines.push(`**Suggested split:**`);
      lines.push(``);
      for (const s of a.suggestedSplit) {
        lines.push(`- \`${s.newFileName}\` — ${s.responsibility}`);
        lines.push(`  - exports: ${s.movedExports.join(", ") || "(none)"}`);
      }
      lines.push(``);
    }
  }

  return lines.join("\n");
}
