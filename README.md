# Cambium

[![CI](https://github.com/okikijesutech/cambium/actions/workflows/ci.yml/badge.svg)](https://github.com/okikijesutech/cambium/actions/workflows/ci.yml)

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

**Install globally from npm** (easiest — no clone required):

```bash
npm install -g @okikijesutech/cambium
```

Or run it without installing anything, via `npx`:

```bash
npx @okikijesutech/cambium --help
```

Either way, the command itself is just `cambium`:

```bash
cambium --help
```

**Or, if you want to hack on the source itself:**

```bash
git clone https://github.com/okikijesutech/cambium.git
cd cambium
npm install
npm run build
node dist/cli.js --help
```

```bash
npm link
```

links your local checkout as the global `cambium` command, so changes
you make take effect immediately without republishing.

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
cambium scan ../my-repo --exclude-tests
```

| Flag | Default | Meaning |
|---|---|---|
| `-n, --top <number>` | `25` | how many outliers to show |
| `-o, --output <path>` | — | save results as a markdown report |
| `--exclude-tests` | off | exclude regular test files (`*.test.ts`, `*.spec.ts`) from results |

Pure type-signature test files (`*.test-d.ts`, the `tsd` convention)
are **always** excluded, unconditionally — they have zero runtime
logic and always show `0` exports/fan-in by design, which floods
outlier rankings with noise on repos that use this pattern (found on
a real test against `execa`). Regular `*.test.ts`/`*.spec.ts` files
are kept by default, since they contain real logic and can
legitimately drift — `--exclude-tests` is opt-in for when you want
production code only (useful on repos with very large test files,
like `hono`, where test files otherwise dominate the top rankings).

Touch-frequency requires the repo to be a git repository with commit
history — if it isn't, Cambium says so and falls back to
complexity/lines/fan-in only, rather than failing.

If a `.cambium/baseline.json` exists (see `cambium baseline` below),
`scan` automatically shows how each file has changed since it was
taken: `Δcomplexity=+3 Δlines=+5`, or `NEW` for files added since.
This is the only signal that tracks whether a file is getting *worse*
over time — everything else is a snapshot of its current state.

### `cambium baseline <repoPath>`

Snapshots every file in the repo (not just the top outliers) to
`.cambium/baseline.json` — a fixed point future `cambium scan` runs
compare against.

```bash
cambium baseline ../my-repo
cambium baseline ../my-repo --force   # overwrite an existing baseline
```

Commit `.cambium/baseline.json` to git so your whole team compares
against the same starting point, not whatever their local machine
happened to see first. Paths are stored relative to the repo root
specifically so this works across machines/clones.

Won't silently overwrite an existing baseline — use `--force` if you
really mean to reset the starting point (you lose the ability to
measure drift since the *original* baseline date when you do this).

### `cambium drift <repoPath>`

Scans the repo, then sends the top outlier files to an LLM to explain
*why* each one is a problem and propose a concrete split.

```bash
cambium drift ../my-repo --top 3
cambium drift ../my-repo --top 3 --json          # raw JSON output
cambium drift ../my-repo --top 3 --output report.md
cambium drift ../my-repo --exclude-tests
cambium drift ../my-repo --file src/context.ts   # analyze exactly one file
```

| Flag | Default | Meaning |
|---|---|---|
| `-n, --top <number>` | `5` | how many top outliers to analyze |
| `-o, --output <path>` | — | save results as a markdown report |
| `--json` | off | raw JSON instead of formatted terminal output |
| `--min-lines <number>` | `80` | skip files below this line count |
| `--min-complexity <number>` | `8` | skip files below this complexity |
| `--exclude-tests` | off | exclude regular test files from consideration |
| `-f, --file <path>` | — | analyze exactly this file, ignoring `--top` and thresholds entirely |

`--file` is for when you already know which file you want (e.g. the
2nd-ranked one from `cambium scan`) and don't want to re-analyze
everything ranked above it — explicit selection overrides `--top`
and `--min-lines`/`--min-complexity` completely, even for a file that
would normally be skipped as too small.

A file must clear **both** `--min-lines` and `--min-complexity` to be
analyzed — splitting into multiple files only makes sense once a file
is both long and complex enough to warrant it. Files below the
threshold are listed and skipped, not silently dropped. Files with
syntax errors are always excluded (see `cambium scan` above) — their
metrics aren't trustworthy enough to analyze.

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

### `cambium check <filePath>`

Fast pass/fail check for a single file — no LLM, no repo scan. Warns
(or fails, with `--strict`) if the file has grown big and complex
enough to warrant a real look. This is the primitive the git hook
below is built on; it's also useful standalone in CI.

```bash
cambium check src/some-module.ts
cambium check src/some-module.ts --strict   # exits non-zero if flagged
```

| Flag | Default | Meaning |
|---|---|---|
| `--min-lines <number>` | `80` | flag threshold for line count |
| `--min-complexity <number>` | `8` | flag threshold for complexity |
| `--strict` | off | exit non-zero when flagged, instead of warning only |

### `cambium install-hook [repoPath]`

Installs a git pre-commit hook that runs `cambium check` on every
staged `.ts`/`.tsx` file — the connection between "an AI agent (or a
human) just wrote code" and "Cambium looks at it," regardless of what
wrote it or which editor/tool was used.

```bash
cambium install-hook .              # warn-only, never blocks commits
cambium install-hook . --strict     # blocks commits on flagged files
```

Warn mode (the default) prints a warning but always lets the commit
through. Strict mode actually blocks the commit (bypass anytime with
`git commit --no-verify`). Uninstall by deleting `.git/hooks/pre-commit`.

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

`warnings` flags problems Cambium found in its own suggestion. Two
kinds, worth telling apart:

**Exact, verified checks** (cross-checked against real static
analysis, not the model's word):
- the same symbol assigned to two different files in the split
- a suggested symbol that's genuinely imported from elsewhere, not
  defined in this file at all — the file doesn't own that code and
  can't "move" it
- a suggested symbol that doesn't match any real export (may be an
  unexported local helper — common for files where everything is
  trapped in closures)
- `hasDrifted: false` with a non-empty `suggestedSplit` (contradictory
  — the split is suppressed, not-drifted takes precedence)

**Heuristic checks** (word-overlap based, explicitly labeled
"not verified" in the warning text itself — can have false negatives
on paraphrased wording):
- a responsibility described in `currentResponsibilities` that isn't
  addressed by any file in `suggestedSplit` — usually means the model
  mislabeled one of its own suggested files (found on a real
  production codebase: a file named `notification-service.ts` had a
  responsibility description about "database transactions," while
  its real exports were about sending notifications — the label and
  the content didn't match)

Treat `suggestedSplit` as a starting point for your own judgment,
especially when `warnings` is non-empty — not a ready-to-execute plan.

**On consistency between runs:** both providers are called with
`temperature: 0` (and a fixed seed for Ollama) so the same file
should get the same verdict run to run. This makes results far more
consistent, not perfectly deterministic — some backends still have
minor floating-point variance under parallel execution. If a file's
`hasDrifted` verdict flips between runs, that's usually a sign the
file is genuinely borderline (its responsibilities are close to
coherent, not clearly one thing or clearly several) rather than a
bug — worth applying your own judgment on files like that rather than
trusting either verdict outright.

## Development

```bash
npm install
npx ts-node src/cli.ts <command>    # run without building
npm run build                        # compile to dist/
npx tsc --noEmit                     # type-check only
npm test                             # run the test suite (vitest)
npm run test:watch                   # watch mode
```

**Testing philosophy:** every test in `tests/` traces to a real bug
found and fixed during development — not invented coverage. Windows
path case-sensitivity, Git Bash POSIX-path conversion, chained
`expect().toBe()` double-counting, syntax-error false positives on
valid-but-untyped code, typo'd-path vs. empty-repo confusion,
`hasDrifted`/`suggestedSplit` contradictions, baseline delta math,
and the description-mismatch guardrail are all locked in as
regressions using the exact real inputs that found each one.

CI (`.github/workflows/ci.yml`) runs type-check, build, tests, and a
smoke test of the compiled CLI on every push/PR to `main`, across
Node 18 and 20.

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

Every item from the original roadmap is now shipped (touch-frequency
in the LLM prompt, `check`/`install-hook`, npm publish, onboarding/
baseline mode). Open ideas for what's next:

- `cambium watch` — background file-watching, closer to real-time than
  the commit-time hook (deferred until there's evidence commit-time
  isn't fast enough)
- Baseline-aware `drift` — currently only `scan` shows deltas; `drift`
  could use "this file is getting worse" as another input to the LLM
  judgment, similar to how touch-frequency already feeds in

## License

ISC — see `LICENSE`.
