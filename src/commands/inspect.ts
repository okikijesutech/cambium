import { Command } from "commander";
import * as fs from "fs";
import { inspectFile, FileInspectionReport } from "../inspect";

export function formatInspectTable(report: FileInspectionReport, limit: number): string {
  const top = report.functions.slice(0, limit);
  const syntaxWarning = report.hasSyntaxErrors
    ? "\n⚠ SYNTAX ERROR — metrics in this file may be unreliable\n"
    : "";

  let out = `\nInspecting: ${report.relativeFilePath}${syntaxWarning}\n`;
  out += `Lines: ${report.lines}  |  Total Complexity: ${report.cyclomaticComplexity}  |  Exports: ${report.exportedSymbols.length}  |  Functions Found: ${report.functionsCount}\n\n`;

  if (top.length === 0) {
    out += "No functions or methods detected in this file.\n";
    return out;
  }

  out += `Top ${top.length} function(s) by Cyclomatic Complexity:\n`;
  out += `Complexity  Lines  Range        Kind         Exported  Name\n`;
  out += `${"-".repeat(78)}\n`;

  for (const fn of top) {
    const compStr = fn.cyclomaticComplexity.toString().padStart(10);
    const linesStr = fn.lines.toString().padStart(5);
    const rangeStr = `L${fn.startLine}-L${fn.endLine}`.padEnd(11);
    const kindStr = fn.kind.padEnd(11);
    const expStr = (fn.isExported ? "yes" : "no").padEnd(8);
    out += `${compStr}  ${linesStr}  ${rangeStr}  ${kindStr}  ${expStr}  ${fn.name}\n`;
  }

  return out;
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .description("Inspect an individual file to find high-complexity functions, methods, and line ranges")
    .argument("<filePath>", "path to a .ts/.tsx file")
    .option("-n, --top <number>", "limit how many top functions to display", "15")
    .option("--json", "output raw JSON instead of formatted table")
    .option("-o, --output <path>", "save report to a file")
    .option("--repo <repoPath>", "optional repository root path for relative file display")
    .action((filePath: string, opts: { top: string; json?: boolean; output?: string; repo?: string }) => {
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }

      let report: FileInspectionReport;
      try {
        report = inspectFile(filePath, opts.repo);
      } catch (err) {
        console.error(`Error inspecting file: ${(err as Error).message}`);
        process.exit(1);
      }

      const limit = parseInt(opts.top, 10) || 15;

      if (opts.json) {
        const jsonOutput = {
          ...report,
          functions: report.functions.slice(0, limit),
        };
        const rendered = JSON.stringify(jsonOutput, null, 2);
        console.log(rendered);

        if (opts.output) {
          fs.writeFileSync(opts.output, rendered, "utf-8");
          console.error(`JSON report saved to ${opts.output}`);
        }
      } else {
        const tableOutput = formatInspectTable(report, limit);
        console.log(tableOutput);

        if (opts.output) {
          fs.writeFileSync(opts.output, tableOutput, "utf-8");
          console.error(`Report saved to ${opts.output}`);
        }
      }
    });
}
