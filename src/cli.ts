#!/usr/bin/env node
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { loadDotEnv } from "./dotenv";
import { registerScanCommand } from "./commands/scan";
import { registerDriftCommand } from "./commands/drift";
import { registerFileCommand } from "./commands/file";
import { registerCheckCommand } from "./commands/check";
import { registerInstallHookCommand } from "./commands/install-hook";

loadDotEnv(path.join(__dirname, ".."));

const program = new Command();

// Read version from package.json rather than hardcoding it here —
// a hardcoded string is exactly the kind of thing that silently goes
// stale across releases (this one already had: it said 0.1.0 while
// package.json was at 1.0.0).
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
);

program
  .name("cambium")
  .description(
    "Structural drift detection — finds files whose scope has outgrown their original design."
  )
  .version(packageJson.version)
  .addHelpText(
    "after",
    `
Quick start:
  $ cambium scan ./my-repo                 # fast, free, no LLM
  $ cambium drift ./my-repo --top 3         # LLM-explained, slower
  $ cambium install-hook .                  # auto-check on every commit

Run 'cambium <command> --help' for that command's full options
(each command has its own flags — see e.g. 'cambium drift --help').`
  );

registerScanCommand(program);
registerDriftCommand(program);
registerFileCommand(program);
registerCheckCommand(program);
registerInstallHookCommand(program);

program.parse();
