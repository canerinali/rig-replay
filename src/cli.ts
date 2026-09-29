#!/usr/bin/env node
import { Command, Option } from "commander";
import { writeFile } from "node:fs/promises";
import { buildReport } from "./index.js";
import { OptionsError, resolveOptions, type RawOptions } from "./options.js";

const program = new Command();
program
  .name("rig-replay")
  .description("Interleave every Claude Code and Codex session that worked in a repo on one offline HTML timeline.")
  .version("0.1.0")
  .option("--repo <path>", "repo to report on (default: cwd); walks up to the nearest .git")
  .option("--since <when>", "2d | 12h | 90m | 2026-09-01 | all", "7d")
  .option("--out <file>", "output path (default: ./rig-replay-report.html; with --json, stdout)")
  .option("--json", "write ReportData as JSON instead of HTML", false)
  .option("--window <dur>", "possible-conflict window", "10m")
  .option("--loop-threshold <n>", "repeats that count as a loop (min 2)", "4")
  .option("--claude-dir <dir>", "Claude projects dir (default: $CLAUDE_CONFIG_DIR/projects or ~/.claude/projects)")
  .option("--codex-dir <dir>", "Codex home (default: $CODEX_HOME or ~/.codex); sessions/ is appended")
  .option("--no-claude", "skip Claude Code logs")
  .option("--no-codex", "skip Codex logs")
  .option("--prices <file.json>", "override the price table used for estimated cost")
  .option("--redact", "replace prompt and command text with length placeholders (paths are kept)", false)
  .addOption(new Option("--now <iso>", "fixed 'now' for deterministic runs").hideHelp())
  .action(async (raw: RawOptions) => {
    try {
      const opts = resolveOptions(raw);
      const data = await buildReport(opts);
      const json = JSON.stringify(data, null, 2) + "\n";
      if (opts.out) await writeFile(opts.out, json);
      else process.stdout.write(json);
    } catch (e) {
      if (e instanceof OptionsError) {
        process.stderr.write(`rig-replay: ${e.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
  });

program.parseAsync(process.argv);
