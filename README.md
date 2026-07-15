# Cambium — Structural Drift Detection (v0.4)

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
  now — and proposes a concrete split when it's drifted

Works with local open-source models via Ollama (free, runs on your
machine) or Claude via the Anthropic API.

## Setup

```bash
npm install
```

If `npm install` fails with ETARGET on ts-morph, see troubleshooting below.

## Run against a single file

```bash
npx ts-node src/run-single.ts path/to/file.ts
```

## Run against a whole repo — static metrics only (no LLM needed)

```bash
npx ts-node src/run-scan.ts /path/to/repo/root
```

Prints top 25 files sorted by outlier score
(`complexity * 2 + lines * 0.1 + fanIn * 3`).

## Run the LLM responsibility-drift pass

Takes the top outlier files from a scan and sends each one to an LLM,
asking it to infer the file's original intended purpose, list the
distinct responsibilities actually present, decide if they've drifted
apart, and propose a concrete split.

### Option A — Ollama (free, runs locally, no API key)

1. Install Ollama from https://ollama.com
2. Pull a code-capable model:
   ```bash
   ollama pull qwen2.5-coder
   ```
3. Ollama runs as a background service automatically on Windows/Mac after
   install — you generally don't need to run `ollama serve` manually.
4. Run:
   ```bash
   npx ts-node src/run-drift.ts /path/to/repo/root 3
   ```
   No environment variables needed — Ollama is the default provider
   whenever `ANTHROPIC_API_KEY` isn't set.

Local inference is slower than a hosted API — expect anywhere from a
few seconds to over a minute per file depending on your hardware. The
script prints per-file progress to the terminal as it works
(`[1/3] Analyzing popup.ts ... done (14.2s)`), so you can see it's
alive rather than staring at a blank terminal.

### Option B — Anthropic API (Claude, costs money per call)

1. Get an API key from console.anthropic.com
2. Set `ANTHROPIC_API_KEY` (see "Configuration" below)
3. Run the same command as above — it'll automatically switch to
   Claude once the key is set.

## Configuration — `.env` file (optional but recommended)

Instead of running `export VAR=value` every time you open a new
terminal, copy `.env.example` to `.env` and fill in what you need:

```bash
cp .env.example .env
```

Then edit `.env` in a text editor. Cambium loads it automatically —
no extra setup, no new dependency. Anything you `export` manually in
your shell still takes priority over `.env`.

**`.env` is already gitignored-worthy if you ever put this in git** —
don't commit it if you add an API key to it.

## Output

```json
{
  "filePath": "...",
  "inferredOriginalPurpose": "...",
  "currentResponsibilities": ["...", "..."],
  "hasDrifted": true,
  "driftSummary": "...",
  "suggestedSplit": [
    { "newFileName": "...", "responsibility": "...", "movedExports": ["..."] }
  ]
}
```

A summary line (files analyzed, how many flagged as drifted, total
time) prints to the terminal before the JSON.

### On Windows / Git Bash (MINGW64)

Avoid paths starting with a single `/` — Git Bash reinterprets them
and points at the wrong drive. Use relative paths:

```bash
npx ts-node src/run-drift.ts ../pwmngerTS 3
```

If you get `fetch failed` talking to Ollama, it's usually a
`localhost` vs `127.0.0.1` resolution issue on Windows. This is now
handled by default (Ollama calls use `127.0.0.1` automatically), but
if it recurs, set `OLLAMA_BASE_URL=http://127.0.0.1:11434` explicitly
in your `.env`.

## Troubleshooting: npm ETARGET on ts-morph

```bash
npm config get registry   # should be https://registry.npmjs.org/
npm cache clean --force
npm install
```

## Next steps (not built yet)

- Save results to a JSON report file, not just terminal output
- Git log touch-frequency pass
- Onboarding scan mode for brownfield repos (baseline + drift-from-here)
- CLI polish: proper flags instead of positional args
