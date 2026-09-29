import path from "node:path";
import type { ReportData } from "./schema.js";
import { isoDate } from "./time.js";

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

export function usdText(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** The stderr summary printed by the CLI. */
export function summaryLines(data: ReportData, outLabel: string | null, cwd: string = process.cwd()): string[] {
  const s = data.stats;
  const lines: string[] = [];
  const since = data.range.sinceMs === null ? "all time" : `since ${isoDate(data.range.sinceMs)}`;
  lines.push(`rig-replay: repo ${data.repo.root} (${since})`);
  if (data.events.length === 0) {
    const scanned = [data.sources.claudeDir, data.sources.codexDir].filter((d): d is string => !!d);
    lines.push(
      `  no sessions found for this repo (${plural(s.filesScanned, "log file")} scanned in: ${scanned.join(", ") || "no sources enabled"})`,
    );
  } else {
    const sub = s.claudeSubagents ? ` (${plural(s.claudeSubagents, "subagent")})` : "";
    lines.push(
      `  claude: ${plural(s.claudeSessions, "session")}${sub}, ${plural(s.claudeEvents, "event")}   codex: ${plural(s.codexSessions, "session")}, ${plural(s.codexEvents, "event")}`,
    );
    const pc = data.warnings.filter((w) => w.kind === "possible-conflict").length;
    const loops = data.warnings.length - pc;
    lines.push(`  ${plural(pc, "possible conflict")}, ${plural(loops, "loop")} (edits observed in logs)`);
    const priced = data.cost.lines.some((l) => l.usd !== null);
    const unpriced = data.cost.lines.filter((l) => l.usd === null).length;
    lines.push(
      `  estimated cost: ${priced ? usdText(data.cost.totalUsd) : "n/a"} (price table: ${data.cost.source}, as of ${data.cost.priceTable.asOf})` +
        (unpriced ? `; ${plural(unpriced, "model")} without a price` : ""),
    );
  }
  if (data.notes.length) {
    lines.push(`  ${plural(data.notes.length, "parser note")}:`);
    for (const n of data.notes.slice(0, 5)) lines.push(`    - ${n}`);
    if (data.notes.length > 5) lines.push(`    (+${data.notes.length - 5} more in the report)`);
  }
  if (outLabel) {
    const rel = path.relative(cwd, outLabel);
    lines.push(`  -> ${rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? `./${rel}` : outLabel}`);
  }
  return lines;
}
