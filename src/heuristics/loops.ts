import type { Lane, RigEvent, Warning } from "../schema.js";
import { formatDuration } from "../time.js";
import { LOOP_SPAN_MS, denseEpisodes, inRepoFiles, laneMap } from "./common.js";

const READ_ONLY_PARSED = new Set(["read", "list_files", "search"]);
const READ_ONLY_FIRST = new Set(["ls", "pwd", "cat", "head", "tail", "wc", "echo", "rg", "grep", "find"]);
const READ_ONLY_TWO = new Set(["sed -n", "git status", "git diff", "git log", "git show"]);

/** Trim, collapse whitespace and strip leading `cd <dir> &&` prefixes. */
export function normalizeCommand(cmd: string): string {
  let s = cmd.replace(/\s+/g, " ").trim();
  for (;;) {
    const m = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/.exec(s);
    if (!m) break;
    s = s.slice(m[0].length);
  }
  return s;
}

export function isReadOnly(e: RigEvent, normalized: string): boolean {
  if (e.parsedTypes && e.parsedTypes.length > 0 && e.parsedTypes.every((t) => READ_ONLY_PARSED.has(t))) return true;
  const words = normalized.split(" ");
  if (READ_ONLY_FIRST.has(words[0] ?? "")) return true;
  return READ_ONLY_TWO.has(`${words[0] ?? ""} ${words[1] ?? ""}`);
}

function groupBy<T>(items: T[], key: (t: T) => string | undefined): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === undefined) continue;
    const arr = m.get(k);
    if (arr) arr.push(it);
    else m.set(k, [it]);
  }
  return m;
}

export function findLoops(
  events: RigEvent[],
  lanes: Lane[],
  threshold: number,
  spanMs: number = LOOP_SPAN_MS,
): Warning[] {
  const byLane = laneMap(lanes);
  const label = (id: string) => byLane.get(id)?.label ?? id;
  const out: Omit<Warning, "id">[] = [];

  // Shell loops: same normalized command repeated in one lane.
  const shells = events
    .filter((e) => e.kind === "shell" && e.command)
    .map((e) => ({ e, tsMs: e.tsMs, norm: normalizeCommand(e.command!) }))
    .filter((x) => x.norm !== "" && !isReadOnly(x.e, x.norm));
  for (const group of groupBy(shells, (x) => `${x.e.laneId}\u0000${x.norm}`).values()) {
    group.sort((a, b) => a.tsMs - b.tsMs);
    for (const ep of denseEpisodes(group, threshold, spanMs)) {
      const n = ep.length;
      const failed = ep.filter((x) => x.e.ok === false).length;
      const startMs = ep[0]!.tsMs;
      const endMs = ep[n - 1]!.tsMs;
      const laneId = ep[0]!.e.laneId;
      let detail = `${label(laneId)} ran it ${n}x in ${formatDuration(endMs - startMs)}`;
      if (failed > 0) detail += `, ${failed} failed`;
      out.push({
        kind: "loop-shell",
        severity: failed * 2 >= n && failed > 0 ? "high" : "low",
        title: `Repeated command: ${ep[0]!.norm.length > 80 ? `${ep[0]!.norm.slice(0, 77)}...` : ep[0]!.norm}`,
        detail,
        lanes: [laneId],
        evidence: ep.map((x) => x.e.id),
        startMs,
        endMs,
      });
    }
  }

  // Edit loops: same file edited repeatedly in one lane.
  const edits = events
    .filter((e) => e.kind === "file_edit" && e.ok !== false)
    .flatMap((e) => [...new Set(inRepoFiles(e))].map((file) => ({ e, file, tsMs: e.tsMs })));
  for (const group of groupBy(edits, (x) => `${x.e.laneId}\u0000${x.file}`).values()) {
    group.sort((a, b) => a.tsMs - b.tsMs);
    for (const ep of denseEpisodes(group, threshold, spanMs)) {
      const n = ep.length;
      const seen = new Set<string>();
      let identical = 0;
      let reverts = 0;
      for (const x of ep) {
        if (x.e.editHash) {
          if (seen.has(x.e.editHash)) identical++;
          seen.add(x.e.editHash);
        }
        if (x.e.revertOf) reverts++;
      }
      const startMs = ep[0]!.tsMs;
      const endMs = ep[n - 1]!.tsMs;
      const laneId = ep[0]!.e.laneId;
      const extras: string[] = [];
      if (identical) extras.push(`${identical} identical edit${identical === 1 ? "" : "s"}`);
      if (reverts) extras.push(`${reverts} revert${reverts === 1 ? "" : "s"}`);
      let detail = `${label(laneId)} edited it ${n}x in ${formatDuration(endMs - startMs)}`;
      if (extras.length) detail += `, ${extras.join(", ")}`;
      detail += " (edits observed in logs)";
      out.push({
        kind: "loop-edit",
        severity: identical > 0 || reverts > 0 ? "high" : "low",
        title: `Repeated edits to ${ep[0]!.file}`,
        detail,
        file: ep[0]!.file,
        lanes: [laneId],
        evidence: ep.map((x) => x.e.id),
        startMs,
        endMs,
      });
    }
  }

  out.sort((a, b) => a.startMs - b.startMs || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title));
  return out.map((w, i) => ({ id: `loop-${i + 1}`, ...w }));
}
