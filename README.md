# Cambium

**Cambium watches your codebase grow and tells you when a module's
scope has outgrown its original shape — before the debt calcifies
into a rewrite.**

AI coding agents are good at generating working code, but they don't
account for where a project is heading. A file that starts focused
tends to accumulate unrelated responsibilities over time — one commit
at a time, none of them alarming on their own — until it's tangled
enough that fixing it means a rewrite instead of a refactor.

Cambium is a structural health layer that sits on top of any codebase
(regardless of which AI agent — or no agent — wrote the code) and:

- **Scans** every file for complexity, size, and how much of the
  codebase depends on it (fan-in)
- **Ranks** files by how much of a structural risk they represent
- **Explains**, using a local or hosted LLM, what a flagged file's
  original responsibility looks like versus what it's actually doing
  now — and proposes a concrete split when it's drifted, flagging any
  suggested split that isn't internally consistent

Validated against a real 126-file production codebase: correctly
identified the two most structurally compromised files without any
prior knowledge of the repo, and correctly explained *why* each one
was a problem.

## Setup

```bash
npm install
```

If `npm install` fails with ETARGET on ts-morph, see troubleshooting
below.

## Usage

```bash
npx ts-node src/cli.ts <command>
```

Or build it and run the compiled CLI directly:

```bash
npm run build
node dist/cli.js <command>
```

### `cambium scan <repoPath>`

Static analysis only — no LLM, no cost, runs in seconds. Walks every
`.ts`/`.tsx` file in the repo, computes complexity/lines/fan-in, and
prints the top outliers.

```bash
npx ts-node src/cli.ts scan ../my-repo
npx ts-node src/cli.ts scan ../my-repo --top 10
```

### `cambium drift <repoPath>`

Scans the repo, then sends the top outlier files to an LLM to explain
*why* each one is a problem and propose a concrete split.

```bash
npx ts-node src/cli.ts drift ../my-repo --top 3
npx ts-node src/cli.ts drift ../my-repo --top 3 --json   # raw JSON output
```

**Local inference is slow.** On modest CPU hardware, expect anywhere
from a few minutes to 15+ minutes per file with Ollama. This is
currently a "run before a big refactor" tool, not a "run on every
save" tool.

#### Provider setup — Ollama (free, local, default)

1. Install Ollama from https://ollama.com
2. `ollama pull qwen2.5-coder`
3. Ollama runs as a background service automatically after install.
   No environment variables needed — this is the default provider
   whenever `ANTHROPIC_API_KEY` isn't set.

#### Provider setup — Anthropic API (Claude, costs money per call)

1. Get an API key from console.anthropic.com
2. Set `ANTHROPIC_API_KEY` (see Configuration below)

### `cambium file <filePath>`

Metrics for a single file.

```bash
npx ts-node src/cli.ts file src/some-module.ts
```

## Configuration — `.env` file (optional but recommended)

```bash
cp .env.example .env
```

Edit `.env` in a text editor. Loaded automatically, no extra setup.
Anything you `export` manually in your shell takes priority over
`.env`.

## Output format (drift command)

Human-readable by default. Add `--json` for:

```json
{
  "filePath": "...",
  "inferredOriginalPurpose": "...",
  "currentResponsibilities": ["...", "..."],
  "hasDrifted": true,
  "driftSummary": "...",
  "suggestedSplit": [
    { "newFileName": "...", "responsibility": "...", "movedExports": ["..."] }
  ],
  "warnings": ["..."]
}
```

`warnings` flags issues in the suggested split itself — e.g. the same
symbol assigned to two different files, which means the split should
be treated as a starting point, not a ready-to-execute plan.

### On Windows / Git Bash (MINGW64)

Avoid paths starting with a single `/` — Git Bash reinterprets them
and points at the wrong drive. Use relative paths:
```bash
npx ts-node src/cli.ts drift ../pwmngerTS --top 3
```

## Troubleshooting: npm ETARGET on ts-morph

```bash
npm config get registry   # should be https://registry.npmjs.org/
npm cache clean --force
npm install
```

## Next steps (not built yet)

- `npm install -g` / `npx cambium` global install (currently run via
  `ts-node` from the project folder)
- Save results to a report file automatically, not just terminal
- Git log touch-frequency signal
- Onboarding scan mode for brownfield repos
