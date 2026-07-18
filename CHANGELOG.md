# Changelog

## [Unreleased]

## [1.2.0]
### Added
- Touch-frequency now feeds into the LLM drift prompt, with explicit
  calibration guidance (a high touch count only reinforces a drift
  verdict already formed from the file's responsibilities — it's not
  a standalone signal on its own, since careful iteration on a small
  file isn't the same thing as scope creep)
- `metrics.ts` now tracks `importedSymbolNames` alongside
  `exportedSymbols`, enabling a sharper guardrail: suggested symbols
  that are genuinely imported from elsewhere (not owned by the file
  at all) now get a distinct, more accurate warning than symbols that
  are merely unexported local helpers
- `hasSyntaxErrors` detection (via TypeScript's syntax-only
  diagnostics) — files that don't actually parse as valid TypeScript
  no longer get silently assigned confident-looking, wrong metrics
### Changed
- `cli.ts` decomposed into `src/commands/{scan,drift,file,check,install-hook}.ts`
  (was complexity 38, 372 lines, flagged as drifted across multiple
  `cambium drift` runs against its own source) — now complexity 1,
  49 lines, pure command-registration wiring
### Fixed (silent-failure audit — six bugs found via deliberate testing)
- Syntax-broken files: excluded from `drift`'s LLM analysis and
  flagged with a clear warning in `scan`, instead of silently
  reporting wrong numbers as fact
- A typo'd repo path returned identical output to a legitimately
  empty repo ("Found 0 files", exit 0) — `scanRepo` now validates the
  path exists first and fails loudly if not
- `file`/`check` commands crashed with a raw internal stack trace on
  a nonexistent path instead of a clean error message
- `drift` always exited 0 even when every file's LLM analysis
  failed — a script/CI checking only exit code would mistake total
  failure for a clean, zero-drift run. Now exits 1 when 100% fail
- The LLM could report `hasDrifted: false` while still returning a
  non-empty `suggestedSplit` — contradictory, and would render as
  "Drifted: no" immediately followed by a "Suggested split:" section.
  Now detected; the split is suppressed (not-drifted takes
  precedence) and a warning is added either direction
- `git` not being installed at all was silently indistinguishable
  from "this folder just isn't a git repo" — both collapsed to the
  same silent `null`, but the former breaks touch-frequency for every
  repo, not just one. Now distinguished via exit status 127 vs 128,
  with a one-time warning for the former
- An import-misattribution bug in the drift prompt: the model would
  sometimes claim a file was responsible for logic it merely imported
  and called (e.g. claiming `cli.ts` did "report formatting" because
  it imported a formatting function from `report.ts`). System prompt
  now explicitly distinguishes dependencies from responsibilities

## [1.1.0]
### Added
- `cambium check <file>` — fast, LLM-free pass/fail check for a single
  file, designed for git hooks and CI
- `cambium install-hook [repoPath]` — installs a git pre-commit hook
  that runs `cambium check` on every staged `.ts`/`.tsx` file, warn-only
  by default, `--strict` to actually block commits
- Quick-start examples and a per-command help pointer added to
  `cambium --help`
### Fixed
- `cambium -V` was hardcoded to `0.1.0` and had gone stale (actual
  version was already 1.0.0); now reads dynamically from `package.json`
  so this can't happen again
- LLM calls (both Ollama and Anthropic) now use `temperature: 0`
  (plus a fixed seed for Ollama) — same file should get the same
  verdict run to run, rather than sampling randomly. Reduces but
  doesn't eliminate variance on genuinely borderline files.

## [1.0.0]
### Added
- LICENSE (ISC) and this changelog
### Changed
- README fully audited against actual CLI behavior — every documented
  command verified against the compiled build before release

## [0.2.0]
### Added
- Git touch-frequency signal — how many commits touch each file,
  merged into the outlier score alongside complexity/lines/fan-in
- Markdown report output (`-o, --output`) on both `scan` and `drift`
- Global install support — `npm link` verified working; ready for
  `npm publish` when desired (not yet published)
### Fixed
- Duplicate outlier-scoring logic (existed separately in `cli.ts` and
  `report.ts`) consolidated into a shared `scoring.ts` module
- Touch-frequency silently returned 0 for every file on Windows due
  to a case-sensitivity mismatch between git's resolved path and
  ts-morph's resolved path — fixed with case-insensitive matching on
  win32
- An earlier, incorrect fix attempt (Git Bash POSIX-path conversion)
  is also included, though it wasn't the root cause of the above

## [0.1.0]
### Added
- Static AST metrics per file: cyclomatic complexity, line count,
  exported symbols, import count (`metrics.ts`, via `ts-morph`)
- Repo-wide scan with fan-in resolution across the whole module graph
  (`scan-repo.ts`)
- LLM-based drift analysis (`analyze-drift.ts`): infers a file's
  original intended purpose, lists actual current responsibilities,
  and proposes a concrete decomposition when they've diverged
  - Supports Ollama (local, free, default) and Anthropic (Claude, API key required)
- Guardrails after real false positives were found in testing:
  - Cross-checks suggested symbols against each file's real exported
    symbols; flags unverified names instead of presenting them as fact
  - Flags the same symbol suggested for two different destination files
  - `--min-lines`/`--min-complexity` thresholds so trivially small
    files don't get spurious split suggestions
- Unified CLI (`scan`, `drift`, `file` commands) replacing three
  separate single-purpose scripts
- Validated against a real 126-file production codebase (a password
  manager browser extension): correctly identified its two most
  structurally compromised files with no prior knowledge of the repo
