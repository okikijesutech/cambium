# Changelog

## [Unreleased]

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
