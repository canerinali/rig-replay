import type { Lane, RigEvent, Warning } from "../schema.js";
import { formatDuration } from "../time.js";
import { inRepoFiles, joinNames, laneMap } from "./common.js";

/**
 * Possible conflicts: two or more lanes editing the same repo file with consecutive edits at most
 * `windowMs` apart. Only edits observed in logs (tool-level) count; failed edits are ignored.
 */
export function findPossibleConflicts(events: RigEvent[], lanes: Lane[], windowMs: number): Warning[] {
  const byLane = laneMap(lanes);
  const byKey = new Map<string, { worktree?: string; file: string; edits: RigEvent[] }>();
  for (const e of events) {
    if (e.kind !== "file_edit" || e.ok === false) continue;
    const worktree = byLane.get(e.laneId)?.worktree;
    for (const f of new Set(inRepoFiles(e))) {
      const key = `${worktree ?? ""}\u0000${f}`;
      let g = byKey.get(key);
      if (!g) {
        g = { ...(worktree ? { worktree } : {}), file: f, edits: [] };
        byKey.set(key, g);
      }
      g.edits.push(e);
    }
  }

  const out: Omit<Warning, "id">[] = [];
  for (const g of byKey.values()) {
    const edits = [...g.edits].sort((a, b) => a.tsMs - b.tsMs);
    const clusters: RigEvent[][] = [];
    let cur: RigEvent[] = [];
    for (const e of edits) {
      const prev = cur[cur.length - 1];
      if (prev && e.tsMs - prev.tsMs > windowMs) {
        clusters.push(cur);
        cur = [];
      }
      cur.push(e);
    }
    if (cur.length) clusters.push(cur);

    for (const c of clusters) {
      const laneIds = [...new Set(c.map((e) => e.laneId))];
      if (laneIds.length < 2) continue;
      const agents = new Set(c.map((e) => e.agent));
      const sessions = new Set(c.map((e) => `${e.agent}:${e.sessionId}`));
      const sameSession = agents.size === 1 && agents.has("claude") && sessions.size === 1;
      const seq: string[] = [];
      for (const e of c) if (seq[seq.length - 1] !== e.laneId) seq.push(e.laneId);
      const interleaved = seq.length > laneIds.length;
      const names = laneIds.map((id) => byLane.get(id)?.label ?? id);
      const startMs = c[0]!.tsMs;
      const endMs = c[c.length - 1]!.tsMs;
      const verb = names.length === 2 ? "both edited it" : "all edited it";
      let detail = `${joinNames(names)} ${verb} within ${formatDuration(endMs - startMs)}`;
      if (interleaved) detail += ", interleaved";
      if (sameSession) detail += "; same session (parent and subagents, likely orchestrated)";
      detail += " (edits observed in logs)";
      out.push({
        kind: "possible-conflict",
        severity: sameSession ? "low" : "high",
        title: `Possible conflict on ${g.file}${g.worktree ? ` @${g.worktree}` : ""}`,
        detail,
        file: g.file,
        lanes: laneIds,
        evidence: c.map((e) => e.id),
        startMs,
        endMs,
      });
    }
  }
  out.sort((a, b) => a.startMs - b.startMs || (a.file ?? "").localeCompare(b.file ?? ""));
  return out.map((w, i) => ({ id: `pc-${i + 1}`, ...w }));
}
