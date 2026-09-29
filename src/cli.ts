#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command, Option } from "commander";
import { buildReport } from "./index.js";
import { OptionsError, resolveOptions, type RawOptions } from "./options.js";
import { renderHtml } from "./report/html.js";
import { summaryLines } from "./summary.js";
import { VERSION } from "./version.js";

const program = new Command();
program
  .name("rig-replay")
  .description(
    "Interleave every Claude Code and Codex session that worked in a repo on one offline HTML timeline,\n" +
      "with possible file conflicts and loops called out. Reads local log files only; no network.",
  )
  .version(VERSION)
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
    let opts;
    try {
      opts = resolveOptions(raw);
    } catch (e) {
      if (e instanceof OptionsError) {
        process.stderr.write(`rig-replay: ${e.message}\n`);
        process.exitCode = 1;
        return;
      }
      throw e;
    }
    let data;
    try {
      data = await buildReport(opts);
    } catch (e) {
      process.stderr.write(`rig-replay: ${(e as Error).message}\n`);
      process.exitCode = 1;
      return;
    }
    const body = opts.json ? `${JSON.stringify(data, null, 2)}\n` : renderHtml(data);
    if (opts.out) {
      try {
        await mkdir(path.dirname(opts.out), { recursive: true });
        await writeFile(opts.out, body);
      } catch (e) {
        process.stderr.write(`rig-replay: cannot write ${opts.out}: ${(e as Error).message}\n`);
        process.exitCode = 1;
        return;
      }
    } else {
      process.stdout.write(body);
    }
    process.stderr.write(`${summaryLines(data, opts.out).join("\n")}\n`);
  });

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`rig-replay: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
