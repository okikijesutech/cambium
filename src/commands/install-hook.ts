import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";

export function registerInstallHookCommand(program: Command): void {
  program
    .command("install-hook")
    .description(
      "Install a git pre-commit hook that runs 'cambium check' on every staged .ts/.tsx file"
    )
    .argument("[repoPath]", "path to the repo root", ".")
    .option(
      "--strict",
      "make the hook block commits when a file is flagged (default: warn only, never blocks)"
    )
    .action((repoPath: string, opts: { strict?: boolean }) => {
      const gitHooksDir = path.join(repoPath, ".git", "hooks");
      if (!fs.existsSync(gitHooksDir)) {
        console.error(
          `No .git/hooks directory found at ${gitHooksDir} — is ${repoPath} a git repo?`
        );
        process.exit(1);
      }

      const hookPath = path.join(gitHooksDir, "pre-commit");
      const strictFlag = opts.strict ? " --strict" : "";

      const script = `#!/bin/sh
# Installed by \`cambium install-hook\` — runs a fast structural check
# on every staged .ts/.tsx file. ${opts.strict ? "Blocks commits" : "Warns only, never blocks"} when a file
# has grown big and complex enough to warrant a look.
#
# Bypass once with: git commit --no-verify
# Uninstall by deleting this file: .git/hooks/pre-commit

FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(ts|tsx)$')

if [ -z "$FILES" ]; then
  exit 0
fi

STATUS=0
for FILE in $FILES; do
  cambium check "$FILE"${strictFlag}
  if [ $? -ne 0 ]; then
    STATUS=1
  fi
done

exit $STATUS
`;

      fs.writeFileSync(hookPath, script, { mode: 0o755 });
      console.log(`Installed pre-commit hook at ${hookPath}`);
      console.log(
        opts.strict
          ? "Mode: strict — flagged files will block commits (bypass with --no-verify)."
          : "Mode: warn only — flagged files are reported but never block commits."
      );
    });
}
