import { Command } from "commander";
import * as fs from "fs";
import { computeMetricsForSingleFile } from "../metrics";

export function registerFileCommand(program: Command): void {
  program
    .command("file")
    .description("Show metrics for a single file")
    .argument("<filePath>", "path to a .ts/.tsx file")
    .action((filePath: string) => {
      if (!fs.existsSync(filePath)) {
        console.error(`Error: File not found: ${filePath}`);
        process.exit(1);
      }
      const metrics = computeMetricsForSingleFile(filePath);
      console.log(JSON.stringify(metrics, null, 2));
    });
}
