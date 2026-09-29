import { DEFAULT_PRICES, estimate, loadPrices, type ModelUsage } from "./cost.js";
import { findClaudeFiles, findCodexFiles, type LogFile } from "./discover.js";
import { mergeResults } from "./merge.js";
import type { ResolvedOptions } from "./options.js";
import { parseClaudeFile } from "./parsers/claude.js";
import { parseCodexFile } from "./parsers/codex.js";
import { resolveTarget } from "./repo.js";
import { addTokens, emptyTokens, type ParseResult, type ReportData, type Tokens } from "./schema.js";

export type { ReportData, RigEvent, Lane, Warning } from "./schema.js";
export type { ResolvedOptions } from "./options.js";
export { resolveOptions } from "./options.js";

async function parseAll(files: LogFile[], concurrency = 8): Promise<ParseResult[]> {
  const results: ParseResult[] = new Array(files.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < files.length) {
      const i = next++;
      const f = files[i]!;
      try {
        results[i] =
          f.agent === "claude"
            ? await parseClaudeFile(f.file, { srcLabel: f.label, ...(f.subagent ? { subagent: f.subagent } : {}) })
            : await parseCodexFile(f.file, { srcLabel: f.label });
      } catch (e) {
        results[i] = { events: [], usage: [], notes: [`${f.label}: could not be read (${(e as Error).message})`] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return results;
}

/** Build the full report data for one repo. Reads local files only; never touches the network. */
export async function buildReport(opts: ResolvedOptions): Promise<ReportData> {
  const target = resolveTarget(opts.repo);
  const roots = [target.mainRoot, ...target.worktrees.map((w) => w.root)];
  const files: LogFile[] = [];
  if (opts.claudeDir) files.push(...(await findClaudeFiles(opts.claudeDir, roots, opts.sinceMs)));
  if (opts.codexDir) files.push(...(await findCodexFiles(opts.codexDir, opts.sinceMs)));

  const parsed = await parseAll(files);
  const merged = mergeResults(parsed, target, opts.sinceMs);
  const notes = parsed.flatMap((p) => p.notes);

  const byModel: Record<string, Tokens> = {};
  const usageByKey = new Map<string, ModelUsage>();
  for (const u of merged.usage) {
    const t = byModel[u.model] ?? emptyTokens();
    addTokens(t, u.tokens);
    byModel[u.model] = t;
    const key = `${u.agent}\u0000${u.model}`;
    const mu = usageByKey.get(key) ?? { model: u.model, agent: u.agent, tokens: emptyTokens() };
    addTokens(mu.tokens, u.tokens);
    usageByKey.set(key, mu);
  }
  const priceTable = opts.pricesFile ? await loadPrices(opts.pricesFile) : DEFAULT_PRICES;
  const modelUsage = [...usageByKey.values()].sort((a, b) => a.model.localeCompare(b.model));
  const cost = estimate(modelUsage, priceTable);

  const events = merged.events;
  const claudeLanes = merged.lanes.filter((l) => l.agent === "claude");
  const codexLanes = merged.lanes.filter((l) => l.agent === "codex");
  const firstMs = events.length ? events[0]!.tsMs : 0;
  const lastMs = events.length ? events[events.length - 1]!.tsMs : 0;

  return {
    version: 1,
    generatedAt: new Date(opts.nowMs).toISOString(),
    repo: { root: target.mainRoot, worktrees: target.worktrees.map((w) => w.root) },
    range: { sinceMs: opts.sinceMs, firstMs, lastMs },
    options: { windowMs: opts.windowMs, loopThreshold: opts.loopThreshold, redacted: opts.redact },
    sources: { claudeDir: opts.claudeDir, codexDir: opts.codexDir },
    stats: {
      claudeSessions: new Set(claudeLanes.map((l) => l.sessionId)).size,
      claudeSubagents: claudeLanes.filter((l) => l.subagent).length,
      claudeEvents: events.filter((e) => e.agent === "claude").length,
      codexSessions: new Set(codexLanes.map((l) => l.sessionId)).size,
      codexEvents: events.filter((e) => e.agent === "codex").length,
      filesScanned: files.length,
    },
    lanes: merged.lanes,
    events,
    warnings: [],
    tokens: { byModel },
    cost: {
      lines: cost.lines,
      totalUsd: cost.totalUsd,
      priceTable,
      source: opts.pricesFile ?? "built-in",
    },
    notes,
  };
}
