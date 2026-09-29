import { matchRoot, toRel, type RepoTarget } from "./repo.js";
import type { Lane, ParseResult, RigEvent, UsageRecord } from "./schema.js";

export interface MergeResult {
  events: RigEvent[];
  lanes: Lane[];
  usage: UsageRecord[];
}

export function laneIdFor(e: Pick<RigEvent, "agent" | "sessionId" | "subagent">, worktree?: string): string {
  return `${e.agent}:${e.sessionId}${e.subagent ? `:${e.subagent.id}` : ""}${worktree ? `@${worktree}` : ""}`;
}

export function laneLabel(e: Pick<RigEvent, "agent" | "sessionId" | "subagent">, worktree?: string): string {
  let label = `${e.agent} ${e.sessionId.slice(0, 8)}`;
  if (e.subagent) label += ` > ${e.subagent.type ?? "subagent"} ${e.subagent.id.slice(0, 4)}`;
  if (worktree) label += ` @${worktree}`;
  return label;
}

/**
 * Keep events whose cwd is inside the target repo set and within the time range, make file paths
 * repo-relative (per worktree), assign lanes and sort stably by (tsMs, laneId, input order).
 */
export function mergeResults(results: ParseResult[], target: RepoTarget, sinceMs: number | null): MergeResult {
  const kept: { e: RigEvent; seq: number }[] = [];
  const lanes = new Map<string, Lane>();
  const usage: UsageRecord[] = [];
  let seq = 0;

  for (const r of results) {
    for (const u of r.usage) {
      if (sinceMs !== null && u.tsMs < sinceMs) continue;
      if (!matchRoot(u.cwd, target)) continue;
      usage.push(u);
    }
    for (const src of r.events) {
      seq++;
      if (sinceMs !== null && src.tsMs < sinceMs) continue;
      const m = matchRoot(src.cwd, target);
      if (!m) continue;
      let outside = false;
      const files = src.files.map((f) => {
        const rel = toRel(f, m.root);
        if (rel === null) {
          outside = true;
          return f;
        }
        return rel;
      });
      const laneId = laneIdFor(src, m.worktree);
      const e: RigEvent = { ...src, files, laneId };
      if (outside) e.outsideRepo = true;
      else delete e.outsideRepo;
      kept.push({ e, seq });

      let lane = lanes.get(laneId);
      if (!lane) {
        lane = {
          id: laneId,
          agent: src.agent,
          sessionId: src.sessionId,
          ...(src.subagent ? { subagent: src.subagent } : {}),
          ...(m.worktree ? { worktree: m.worktree } : {}),
          label: laneLabel(src, m.worktree),
          firstMs: src.tsMs,
          lastMs: src.tsMs,
          eventCount: 0,
        };
        lanes.set(laneId, lane);
      }
      lane.eventCount++;
      lane.firstMs = Math.min(lane.firstMs, src.tsMs);
      lane.lastMs = Math.max(lane.lastMs, src.tsMs);
    }
  }

  kept.sort((a, b) => a.e.tsMs - b.e.tsMs || (a.e.laneId < b.e.laneId ? -1 : a.e.laneId > b.e.laneId ? 1 : 0) || a.seq - b.seq);
  const laneList = [...lanes.values()].sort(
    (a, b) => a.firstMs - b.firstMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { events: kept.map((k) => k.e), lanes: laneList, usage };
}
