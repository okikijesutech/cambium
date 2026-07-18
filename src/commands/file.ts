import { Command } from "commander";
import { computeMetricsForSingleFile } from "../metrics";

export function registerFileCommand(program: Command): void {
  program
    .command("file")
    .description("Show metrics for a single file")
    .argument("<filePath>", "path to a .ts/.tsx file")
    .action((filePath: string) => {
      const metrics = computeMetricsForSingleFile(filePath);
      console.log(JSON.stringify(metrics, null, 2));
    });
}
