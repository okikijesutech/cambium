import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { scanRepo } from "../scan-repo";
import { getTouchFrequency } from "../git-history";
import { attachTouchFrequency } from "../scoring";
import { saveBaseline, baselineExists } from "../baseline";

export function registerBaselineCommand(program: Command): void {
  program
    .command("baseline")
    .description(
      "Snapshot the current state of every file in a repo — a fixed point future 'cambium scan' " +
        "runs can compare against, to show whether a file is getting worse, not just how bad it is now."
    )
    .argument("<repoPath>", "path to the repo root")
    .option("--force", "overwrite an existing baseline instead of refusing")
    .action((repoPath: string, opts: { force?: boolean }) => {
      if (baselineExists(repoPath) && !opts.force) {
        console.error(
          `A baseline already exists for ${repoPath} (.cambium/baseline.json).\n` +
            `Use --force to overwrite it, or delete .cambium/baseline.json manually.\n` +
            `(Overwriting loses the ability to measure drift since the ORIGINAL baseline date.)`
        );
        process.exit(1);
      }

      console.error(`Scanning ${repoPath} (full repo, no --top limit) ...`);

      let rawResults;
      try {
        rawResults = scanRepo(repoPath);
      } catch (err) {
        console.error(`Error: ${(err as Error).message}`);
        process.exit(1);
      }
      console.error(`Found ${rawResults.length} file(s).`);

      const touchFrequency = getTouchFrequency(repoPath);
      const results = attachTouchFrequency(rawResults, touchFrequency);

      const packageJson = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf-8")
      );

      saveBaseline(repoPath, results, packageJson.version);

      console.error(
        `\nBaseline saved: ${results.length} file(s) snapshotted to ` +
          `${path.join(repoPath, ".cambium", "baseline.json")}\n`
      );
      console.error(
        `Commit .cambium/baseline.json to git so your whole team compares against the same ` +
          `fixed point. Future 'cambium scan' runs will automatically show deltas against it.`
      );
    });
}
