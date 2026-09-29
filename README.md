# rig-replay

rig-replay turns the local logs of every Claude Code and Codex session that worked in one repo into a single offline HTML timeline. It calls out **possible conflicts** (two agents or sessions editing the same file close together) and **loops** (the same command or edit repeated), each linked to the log lines that show it. It reads local files only and makes no network requests.

<!-- badges -->

**Install:** nothing to install, run it with `npx rig-replay` (Node.js 22 or newer).

**Usage:** `npx rig-replay --since 2d` inside your repo writes `./rig-replay-report.html`.

## Features

- **One repo, all agents, one timeline.** Claude Code sessions (including subagents) and Codex CLI sessions are interleaved as lanes on a single SVG timeline. Linked git worktrees get their own lanes.
- **Possible conflicts.** Two or more lanes that edited the same file with consecutive edits within `--window` (default 10m). High severity across agents or top-level sessions; low when it is a parent session and its own subagents. `interleaved` is flagged when edits went A, B, A.
- **Loops.** The same shell command run `--loop-threshold` times (default 4) within 30 minutes in one lane, or the same file edited that often. Failed runs, identical edits and reverts raise the severity. Read-only commands (`ls`, `cat`, `rg`, `git status`, ...) are ignored.
- **Evidence links.** Every warning links to the exact events, and every event shows its source `file:line` in the logs.
- **Filters.** By file (with edit counts), event kind, lane and free text. Filters apply to both the timeline and the table.
- **Estimated cost.** Tokens per model plus an estimated cost, shown next to the price table that produced it. Override it with `--prices`.
- **Self-contained output.** One HTML file with inline CSS and JS, and no external URLs. `--json` writes the raw data instead.
- **`--redact`.** Replaces prompt and command text with length placeholders so you can share a report. File paths are kept.

## Example output

```
$ npx rig-replay --repo /work/acme-api --since all \
    --claude-dir examples/demo-logs/claude/projects --codex-dir examples/demo-logs/codex \
    --now 2026-09-21T00:00:00Z --out examples/demo-report.html
rig-replay: repo /work/acme-api (all time)
  claude: 2 sessions (1 subagent), 21 events   codex: 2 sessions, 13 events
  1 possible conflict, 1 loop (edits observed in logs)
  estimated cost: $0.20 (price table: built-in, as of 2026-09-29)
  -> ./examples/demo-report.html
```

The report then lists, for example:

- **HIGH** Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df both edited it within 9m, interleaved (edits observed in logs)
- **HIGH** Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed

The demo uses bundled synthetic logs. See [examples/README.md](examples/README.md) to run it yourself.

More examples:

```
npx rig-replay                                        # current repo, last 7 days
npx rig-replay --repo ~/src/acme-api --since 2d --out /tmp/acme.html
npx rig-replay --since all --window 30m --loop-threshold 3
npx rig-replay --json --since 1d | jq '.warnings[] | .title'
npx rig-replay --redact --out shareable.html
```

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `--repo <path>` | cwd | Repo to report on. Walks up to the nearest `.git` (a directory or a worktree `.git` file). A path that does not exist is used literally. |
| `--since <when>` | `7d` | `90m`, `12h`, `2d`, `1w`, a date (`2026-09-01`, UTC) or `all`. |
| `--out <file>` | `./rig-replay-report.html` | Output path. With `--json` and no `--out`, JSON goes to stdout. |
| `--json` | off | Write the report data as JSON instead of HTML. |
| `--window <dur>` | `10m` | Window for possible conflicts. |
| `--loop-threshold <n>` | `4` | Repeats that count as a loop (at least 2). |
| `--claude-dir <dir>` | `$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects` | Claude Code projects directory. |
| `--codex-dir <dir>` | `$CODEX_HOME` or `~/.codex` | Codex home (`sessions/` is appended). |
| `--no-claude`, `--no-codex` | | Skip a source. |
| `--prices <file.json>` | built-in | Price table used for the estimated cost. |
| `--redact` | off | Replace prompt and command text with `[redacted N chars]`. |

The summary goes to stderr, and stdout is reserved for `--json`. The exit code is 0 on success (including when no sessions are found, in which case the message names the directories that were scanned). It is 1 for bad options or an output path that cannot be written.

A price file looks like this. Entries are checked in order, and `match` is a model-name prefix, or a glob when it contains `*`:

```json
{
  "asOf": "2026-09-29",
  "currency": "USD",
  "models": [
    { "match": "claude-sonnet-5", "inputPerMTok": 2, "outputPerMTok": 10, "cacheReadPerMTok": 0.2, "cacheWritePerMTok": 2.5 },
    { "match": "gpt-5.3-codex", "inputPerMTok": 1.75, "outputPerMTok": 14, "cacheReadPerMTok": 0.175, "cacheWritePerMTok": 0 }
  ]
}
```

## How it works / heuristics

1. **Discovery.** Claude Code: `<claude-dir>/<encoded-cwd>/<session>.jsonl` plus `<session>/subagents/agent-<id>.jsonl` (the subagent type comes from the sibling `.meta.json`). The encoded directory name is only a pre-filter, and the `cwd` field on each line decides. Codex: `<codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl`. Old date folders and files not modified since `--since` are skipped.
2. **Parsing.** Every JSONL line is parsed on its own. Malformed lines and unknown line types are counted and reported as parser notes. They never stop a run.
   - Claude Code: `Edit`, `MultiEdit`, `Write` and `NotebookEdit` are edits; `Bash` is a shell command; everything else is a tool call. Tool results set ok/failed. Token usage is counted once per API message.
   - Codex CLI: the current format (`item_completed` events with `CommandExecution`, `FileChange` and `UserMessage` items, seen in CLI 0.154 to 0.157) is supported, and the older `function_call` / `apply_patch` format is supported on a best-effort basis. Tokens come from deltas of the cumulative `token_count` totals. A rollout the parser cannot recognize produces a parser note instead of silently yielding nothing.
3. **Repo mapping.** An event belongs to the report when its `cwd` is inside the repo root or one of its linked worktrees (found by reading `.git` files and `.git/worktrees/*/gitdir`, without running `git`). File paths become repo-relative. Files outside the repo are shown but ignored by the heuristics.
4. **Heuristics.** They run on tool-level events only:
   - **Attribution means edits observed in logs.** An edit that bypassed the agent's edit tools (for example `sed -i` or `cat > file` in a shell command, or a code generator) is invisible to rig-replay.
   - **Conflicts are always "possible".** Two sessions editing the same file close together is worth a look, but it is not proof that work was lost. Conflicts are computed per worktree, and failed edits do not count.
   - **Loops** need the threshold number of repeats within any 30-minute span in one lane.
5. **Estimated cost.** Tokens per model are multiplied by the price table (the built-in table was copied from the Anthropic and OpenAI public pricing pages on its `asOf` date). Claude cache reads and writes are billed separately. For Codex, cached input is billed at the cache-read price and the rest of the input at the input price. Models without a matching entry show "no price". The result is an **estimate**: plans, discounts, batch or regional pricing and anything not in the logs are not reflected.

Not in scope for v0.1: live/watch mode, agents other than Claude Code and Codex CLI, line-level blame or diffs, git history correlation, cross-worktree overlap warnings, splitting Codex multi-agent threads into lanes, secret scanning (`--redact` is the only privacy control), a config file and a CI mode.

## Privacy

rig-replay reads local log files only. There is no network, no telemetry and no child processes. The HTML report is fully self-contained: it loads no scripts, fonts, images or stylesheets from anywhere, so it can be opened offline from `file://`. The report does contain your prompts, commands and file paths (use `--redact` to strip prompt and command text), so treat it like the logs it came from.

## Contributing

Issues and pull requests are welcome.

```
npm install
npm test          # vitest: unit, snapshot, labeled scenario and end-to-end CLI tests
npm run build     # tsc -> dist/
npm run example   # builds, then writes examples/demo-report.html from the synthetic demo logs
```

- Test fixtures are synthetic and hand-written. Never commit real session logs.
- New heuristics need a labeled scenario under `test/fixtures/scenarios/<name>/` with an `expected.json`. The `sequential` scenario is the false-positive gate: it must stay warning-free.
- Keep the wording rules: "edits observed in logs", "possible conflict", "estimated cost".

## License

[MIT](LICENSE) © 2026 canerinali
