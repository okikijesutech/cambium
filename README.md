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
(regardless of which AI agent — or no agent — wrote the code):

- **Scans** every file for complexity, size, fan-in (how much of the
  codebase depends on it), and git touch-frequency (how many commits
  keep coming back to it)
- **Ranks** files by combined structural risk across those signals
- **Explains**, using a local or hosted LLM, what a flagged file's
  original responsibility looks like versus what it's actually doing
  now — and proposes a concrete split when it's drifted
- **Guards against its own mistakes**: cross-checks every suggested
  split against the file's real exported symbols, flags suggestions
  that don't hold up, and skips files too small to meaningfully split
  in the first place

Validated against a real 126-file production codebase (a password
manager extension): correctly identified the two most structurally
compromised files with no prior knowledge of the repo, correctly
explained *why* each was a problem, and — after adding guardrails —
correctly stopped flagging a file it had previously misdiagnosed.

## Install

**Try it without installing anything globally, from inside the project:**

```bash
git clone https://github.com/okikijesutech/cambium.git
cd cambium
npm install
npm run build
node dist/cli.js --help
```

**Or install it as a global command** (recommended once you're past
first-try):

```bash
npm link
```

Then run `cambium` from any directory, on any repo:

```bash
cambium --help
```

If `npm install` fails with `ETARGET` on `ts-morph`, see
Troubleshooting below.

## Commands

### `cambium scan <repoPath>`

Static analysis only — no LLM, no cost, runs in seconds. Walks every
`.ts`/`.tsx` file in the repo, computes complexity/lines/fan-in/git
touch-frequency, and prints the top outliers.

```bash
cambium scan ../my-repo
cambium scan ../my-repo --top 10
cambium scan ../my-repo --output scan-report.md
```

| Flag | Default | Meaning |
|---|---|---|
| `-n, --top <number>` | `25` | how many outliers to show |
| `-o, --output <path>` | — | save results as a markdown report |

Touch-frequency requires the repo to be a git repository with commit
history — if it isn't, Cambium says so and falls back to
complexity/lines/fan-in only, rather than failing.

### `cambium drift <repoPath>`

Scans the repo, then sends the top outlier files to an LLM to explain
*why* each one is a problem and propose a concrete split.

```bash
cambium drift ../my-repo --top 3
cambium drift ../my-repo --top 3 --json          # raw JSON output
cambium drift ../my-repo --top 3 --output report.md
```

| Flag | Default | Meaning |
|---|---|---|
| `-n, --top <number>` | `5` | how many top outliers to analyze |
| `-o, --output <path>` | — | save results as a markdown report |
| `--json` | off | raw JSON instead of formatted terminal output |
| `--min-lines <number>` | `80` | skip files below this line count |
| `--min-complexity <number>` | `8` | skip files below this complexity |

A file must clear **both** `--min-lines` and `--min-complexity` to be
analyzed — splitting into multiple files only makes sense once a file
is both long and complex enough to warrant it. Files below the
threshold are listed and skipped, not silently dropped.

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
cambium file src/some-module.ts
```

## Configuration

Copy `.env.example` to `.env` and fill in what you need — loaded
automatically, no extra setup required. Anything you `export`
manually in your shell takes priority over `.env`.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | switches provider to Claude when set |
| `LLM_PROVIDER` | auto | force `ollama` or `anthropic` explicitly |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server address |
| `OLLAMA_MODEL` | `qwen2.5-coder:latest` | which local model to use |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | which Claude model to use |

## Output format (drift command, `--json`)

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

`warnings` flags problems Cambium found in its own suggestion, e.g.:
- the same symbol assigned to two different files in the split
- suggested symbols that don't match the file's real exported symbols
  (common for files where everything is trapped in closures — the
  model is naming what it read, not verified exports)

Treat `suggestedSplit` as a starting point for your own judgment,
especially when `warnings` is non-empty — not a ready-to-execute plan.

## Development

```bash
npm install
npx ts-node src/cli.ts <command>    # run without building
npm run build                        # compile to dist/
npx tsc --noEmit                     # type-check only
```

### On Windows / Git Bash (MINGW64)

Avoid paths starting with a single `/` — Git Bash reinterprets them
and points at the wrong drive. Use relative paths from wherever
you're standing:
```bash
cambium drift pwmngerTS --top 3
```

## Troubleshooting

**`npm install` fails with `ETARGET` on `ts-morph`:**
```bash
npm config get registry   # should be https://registry.npmjs.org/
npm cache clean --force
npm install
```

**Ollama calls fail with `fetch failed`:** usually means Ollama isn't
running, or (on Windows) a `localhost` vs `127.0.0.1` resolution
issue — Cambium defaults to `127.0.0.1` already, but if it recurs, set
`OLLAMA_BASE_URL=http://127.0.0.1:11434` explicitly in `.env`.

**All touch counts show 0:** confirm the repo actually has git
history (`git log --oneline` inside it). If it does and counts are
still 0, this was a real bug on Windows in earlier versions
(case-sensitivity in path matching) — make sure you're on the latest
build.

## Roadmap

- Onboarding scan mode for brownfield repos (baseline + drift-from-here)
- Published to npm registry (`npm install -g cambium`) — not yet published
- Touch-frequency + LLM context (currently two separate signals, not
  yet combined into the drift-explanation prompt)

## License

ISC — see `LICENSE`.
