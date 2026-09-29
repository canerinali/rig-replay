# rig-replay demo

`demo-logs/` contains **synthetic** Claude Code and Codex logs that describe a 90-minute afternoon in a fake repo at `/work/acme-api`. No real session data is included. The repo path does not exist on disk, so `--repo` uses it literally.

## Run it

From the repository root:

```
npm install
npm run example
```

This builds the CLI and runs:

```
node dist/cli.js --repo /work/acme-api --since all \
  --claude-dir examples/demo-logs/claude/projects --codex-dir examples/demo-logs/codex \
  --now 2026-09-21T00:00:00Z --out examples/demo-report.html
```

Then open `examples/demo-report.html` in a browser. It works offline from `file://`.

## What is in the logs

- **claude 5b0c1d2e**: "add pagination to the orders endpoint". It reads files, spawns an `Explore` subagent that only reads (its own lane: `claude 5b0c1d2e > Explore a9e3`), edits `src/routes/orders.ts` and `src/db.ts`, and runs tests.
- **codex 01a0e0df** (current Codex format): starts 20 minutes later in another terminal with "fix the flaky db test". It edits `src/db.ts` between two Claude edits of the same file, then runs `npm test -- db` five times, four of them failing.
- **claude 7c9d4e1f**: a later session that only touches `src/auth.ts` (no warning).
- **codex 0b0b0b0b** (legacy Codex format): a short README update.
- A session in `/work/other-repo`, which is correctly left out of the report.

## What to look for

1. **Two warnings at the top.** A high-severity *possible conflict* on `src/db.ts` (Claude and Codex edits interleaved within 9 minutes), and a high-severity *loop* for `npm test -- db` (5 runs, 4 failed).
2. **Click an evidence link** (`#1`, `#2`, ...). The event table filters to `src/db.ts` and scrolls to the highlighted row, which shows its source `file:line` in the logs.
3. **The file filter.** Pick `src/db.ts` to see only the events that touched it, on the timeline and in the table.
4. **The timeline.** One row per lane. Dots with a red outline are evidence for a warning. Click a dot to jump to its row.
5. **Estimated cost at the bottom.** Tokens per model, the estimated cost, and the full price table (with its `asOf` date) that produced it.

Try `--redact`, `--window 2m` (the possible conflict disappears) or `--loop-threshold 6` (the loop disappears) to see how the settings change the result.
