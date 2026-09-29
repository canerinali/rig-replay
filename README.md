# rig-replay

**See what all your coding agents did in one repo, on one timeline, and catch the file two of them edited before you merge.**

English · [Türkçe](.github/readme/README.tr.md) · [简体中文](.github/readme/README.zh-CN.md) · [Español](.github/readme/README.es.md) · [Português (BR)](.github/readme/README.pt-BR.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node >=22](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](package.json) [![GitHub tag](https://img.shields.io/github/v/tag/canerinali/rig-replay)](https://github.com/canerinali/rig-replay/tags) [![GitHub stars](https://img.shields.io/github/stars/canerinali/rig-replay?style=social)](https://github.com/canerinali/rig-replay)

Repository: https://github.com/canerinali/rig-replay

<!-- demo GIF: add .github/assets/demo.gif here once it is recorded -->

rig-replay reads the local logs of every Claude Code and Codex session that worked in one repo and writes a single offline HTML timeline. It calls out **possible conflicts** (two agents or sessions editing the same file close together) and **loops** (the same command or edit repeated), each linked to the log lines that show it.

```
npx rig-replay --since 2d
```

Nothing to install (Node.js 22 or newer). Run it inside your repo; it writes `./rig-replay-report.html`.

## Before / after

**Before:** two agents in two terminals, logs in two formats, and you find out at merge time.

```
terminal 1  claude  "add pagination to the orders endpoint"   edits src/db.ts
terminal 2  codex   "fix the flaky db test"                   edits src/db.ts, runs npm test 5x
terminal 1  claude                                            edits src/db.ts again

~/.claude/projects/-work-acme-api/*.jsonl        one format, one file per session
~/.codex/sessions/2026/09/20/rollout-*.jsonl     another format, another place

...at merge time: "who changed the query in src/db.ts?"
```

**After:** one command, one timeline, and the warning is waiting for you.

```
$ npx rig-replay --since 2d
rig-replay: repo /work/acme-api (since 2026-09-19)
  claude: 2 sessions (1 subagent), 21 events   codex: 2 sessions, 13 events
  1 possible conflict, 1 loop (edits observed in logs)
  estimated cost: $0.20 (price table: built-in, as of 2026-09-29)
  -> ./rig-replay-report.html
  note: report contains prompt and command text (known secret shapes are masked); use --redact before sharing

In the report:
  HIGH  Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df, interleaved within 9m
  HIGH  Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed
```

The "after" output comes from the bundled synthetic demo logs ([examples/README.md](examples/README.md)).

## Features

- One HTML timeline for every Claude Code and Codex CLI session in a repo
- Subagents and linked git worktrees get their own lanes
- **Possible conflict** warnings when two lanes edit the same file close together
- **Loop** warnings for the same command or edit repeated, weighted up by failures and reverts
- Every warning links to the exact events, and every event shows its source `file:line`
- Filter by file, event kind, lane or free text, on both the timeline and the table
- Estimated token cost per model, shown next to the price table that produced it
- `--redact` replaces prompt and command text so a report can be shared
- `--json` writes the raw report data for scripts and `jq`
- Local only: no network, no telemetry, no child processes, one self-contained file

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
  note: report contains prompt and command text (known secret shapes are masked); use --redact before sharing
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
   - **Conflicts are always "possible".** Two or more lanes that edited the same file with consecutive edits within `--window` (default 10m). It is worth a look, but it is not proof that work was lost. Severity is high across agents or top-level sessions, and low when it is a parent session and its own subagents. `interleaved` is flagged when edits went A, B, A. Conflicts are computed per worktree, and failed edits do not count.
   - **Loops.** The same shell command run `--loop-threshold` times (default 4) within any 30-minute span in one lane, or the same file edited that often. Failed runs, identical edits and reverts raise the severity. Read-only commands (`ls`, `cat`, `rg`, `git status`, ...) are ignored.
5. **Estimated cost.** Tokens per model are multiplied by the price table (the built-in table was copied from the Anthropic and OpenAI public pricing pages on its `asOf` date). Claude cache reads and writes are billed separately. For Codex, cached input is billed at the cache-read price and the rest of the input at the input price. Models without a matching entry show "no price". The result is an **estimate**: plans, discounts, batch or regional pricing and anything not in the logs are not reflected.

Not in scope for v0.1: live/watch mode, agents other than Claude Code and Codex CLI, line-level blame or diffs, git history correlation, cross-worktree overlap warnings, splitting Codex multi-agent threads into lanes, secret scanning beyond the pattern masking described under Privacy, a config file and a CI mode.

## Privacy

rig-replay reads local log files only. There is no network, no telemetry and no child processes. The HTML report is fully self-contained: it loads no scripts, fonts, images or stylesheets from anywhere, so it can be opened offline from `file://`.

What ends up in the report:

- **Always masked.** Well-known credential shapes are replaced with `[redacted secret]` when prompts and commands are parsed, with or without `--redact`. That covers OpenAI/Anthropic `sk-` keys, GitHub tokens (`ghp_`, `gho_`, `github_pat_`, ...), AWS access key ids (`AKIA...`), Slack `xox?-` tokens, Google `AIza...` keys, PEM private keys, `Authorization: Bearer|Basic ...` and `Bearer <token>`, and `NAME=value` assignments where NAME looks like a secret (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, ...). This is pattern matching, so it cannot catch everything.
- **Kept unless you pass `--redact`.** Prompt text and shell command text (up to 200 characters per event in the HTML), plus file paths and working directories. The CLI prints a reminder on stderr when `--redact` is off.
- **Never embedded.** Tool outputs and file contents. Edits are reduced to line counts and a hash.

The report file is written with mode `0600`, and rig-replay refuses to write through a symlink at the output path. Treat the report like the logs it came from, and use `--redact` before sharing it.

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
