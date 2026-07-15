import * as fs from "fs";
import * as path from "path";

/**
 * Minimal .env loader — no new dependency needed for this. Reads
 * KEY=VALUE lines from a .env file in the project root, if present,
 * and applies them to process.env (without overwriting anything
 * already set via `export` in the current shell).
 */
export function loadDotEnv(projectRoot: string) {
  const envPath = path.join(projectRoot, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}
