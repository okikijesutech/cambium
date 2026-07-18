import { Command } from "commander";
import { computeMetricsForSingleFile } from "../metrics";

export interface CheckResult {
  flagged: boolean;
  message: string;
  lines: number;
  complexity: number;
}

/**
 * Pure logic, separated from CLI wiring (process.exit, console.log)
 * so it's independently testable and reusable — e.g. a future
 * `cambium watch` mode could call this directly without shelling out.
 */
export function checkFile(
  filePath: string,
  minLines: number,
  minComplexity: number,
  strict: boolean
): CheckResult {
  const metrics = computeMetricsForSingleFile(filePath);
  const flagged = metrics.lines >= minLines && metrics.cyclomaticComplexity >= minComplexity;

  const message = flagged
    ? `${strict ? "FAIL" : "WARN"}  ${filePath}  ` +
      `(lines=${metrics.lines}, complexity=${metrics.cyclomaticComplexity}) — ` +
      `big/complex enough to warrant a look. Try: cambium drift <repo> --top 1`
    : `OK  ${filePath}  (lines=${metrics.lines}, complexity=${metrics.cyclomaticComplexity})`;

  return { flagged, message, lines: metrics.lines, complexity: metrics.cyclomaticComplexity };
}

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description(
      "Fast pass/fail check for a single file — warns (or fails, with --strict) if it's grown big and complex enough to warrant a real look. Designed for git hooks and CI."
    )
    .argument("<filePath>", "path to a .ts/.tsx file")
    .option("--min-lines <number>", "flag threshold for line count", "80")
    .option("--min-complexity <number>", "flag threshold for complexity", "8")
    .option("--strict", "exit non-zero when flagged, instead of warning only")
    .action(
      (
        filePath: string,
        opts: { minLines: string; minComplexity: string; strict?: boolean }
      ) => {
        const result = checkFile(
          filePath,
          parseInt(opts.minLines, 10),
          parseInt(opts.minComplexity, 10),
          !!opts.strict
        );

        if (result.flagged && opts.strict) {
          console.error(result.message);
          process.exitCode = 1;
        } else {
          console.log(result.message);
        }
      }
    );
}
