import { describe, expect, it } from "vitest";
import { findPossibleConflicts } from "../src/heuristics/conflicts.js";
import type { Lane, RigEvent } from "../src/schema.js";

const lanes: Lane[] = [
  { id: "claude:s1", agent: "claude", sessionId: "s1", label: "claude s1", firstMs: 0, lastMs: 0, eventCount: 0 },
  { id: "codex:s2", agent: "codex", sessionId: "s2", label: "codex s2", firstMs: 0, lastMs: 0, eventCount: 0 },
  { id: "codex:s3@wt", agent: "codex", sessionId: "s3", worktree: "wt", label: "codex s3 @wt", firstMs: 0, lastMs: 0, eventCount: 0 },
  {
    id: "claude:s1:sub",
    agent: "claude",
    sessionId: "s1",
    subagent: { id: "sub" },
    label: "claude s1 > subagent sub",
    firstMs: 0,
    lastMs: 0,
    eventCount: 0,
  },
];

let n = 0;
function edit(laneId: string, tsMs: number, files: string[], extra: Partial<RigEvent> = {}): RigEvent {
  const lane = lanes.find((l) => l.id === laneId)!;
  return {
    id: `e${++n}`,
    tsMs,
    agent: lane.agent,
    sessionId: lane.sessionId,
    ...(lane.subagent ? { subagent: lane.subagent } : {}),
    laneId,
    cwd: "/r",
    kind: "file_edit",
    files,
    summary: "",
    src: { file: "f", line: 1 },
    ...extra,
  };
}

const W = 10 * 60_000;

describe("findPossibleConflicts", () => {
  it("counts a gap equal to the window, not window + 1ms", () => {
    expect(findPossibleConflicts([edit("claude:s1", 0, ["a.ts"]), edit("codex:s2", W, ["a.ts"])], lanes, W)).toHaveLength(1);
    expect(findPossibleConflicts([edit("claude:s1", 0, ["a.ts"]), edit("codex:s2", W + 1, ["a.ts"])], lanes, W)).toHaveLength(0);
  });

  it("chains clusters through consecutive edits", () => {
    const ws = findPossibleConflicts(
      [edit("claude:s1", 0, ["a.ts"]), edit("claude:s1", W, ["a.ts"]), edit("codex:s2", 2 * W, ["a.ts"])],
      lanes,
      W,
    );
    expect(ws).toHaveLength(1);
    expect(ws[0]!.evidence).toHaveLength(3);
    expect(ws[0]!.detail).not.toContain("interleaved");
  });

  it("ignores failed edits, outside-repo files, single lanes and other files", () => {
    expect(
      findPossibleConflicts(
        [
          edit("claude:s1", 0, ["a.ts"]),
          edit("codex:s2", 1000, ["a.ts"], { ok: false }),
          edit("claude:s1", 0, ["/etc/x"]),
          edit("codex:s2", 1000, ["/etc/x"]),
          edit("codex:s2", 1000, ["b.ts"]),
          edit("codex:s2", 2000, ["b.ts"]),
        ],
        lanes,
        W,
      ),
    ).toEqual([]);
  });

  it("does not compare across worktrees", () => {
    expect(findPossibleConflicts([edit("claude:s1", 0, ["a.ts"]), edit("codex:s3@wt", 1, ["a.ts"])], lanes, W)).toEqual([]);
  });

  it("marks parent+subagent as low and cross-agent as high", () => {
    const low = findPossibleConflicts([edit("claude:s1", 0, ["a.ts"]), edit("claude:s1:sub", 1, ["a.ts"])], lanes, W);
    expect(low[0]!.severity).toBe("low");
    const high = findPossibleConflicts(
      [edit("claude:s1", 0, ["a.ts"]), edit("codex:s2", 60_000, ["a.ts"]), edit("claude:s1", 120_000, ["a.ts"])],
      lanes,
      W,
    );
    expect(high[0]).toMatchObject({ severity: "high", id: "pc-1", title: "Possible conflict on a.ts", file: "a.ts" });
    expect(high[0]!.detail).toBe("claude s1 and codex s2 both edited it within 2m, interleaved (edits observed in logs)");
  });
});
