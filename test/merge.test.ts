import { describe, expect, it } from "vitest";
import { laneLabel, mergeResults } from "../src/merge.js";
import type { RepoTarget } from "../src/repo.js";
import type { ParseResult, RigEvent } from "../src/schema.js";

const target: RepoTarget = {
  mainRoot: "/work/acme-api",
  worktrees: [{ name: "wt-feature", root: "/work/acme-api-wt" }],
  literal: false,
};

function ev(p: Partial<RigEvent> & Pick<RigEvent, "id" | "tsMs">): RigEvent {
  return {
    agent: "claude",
    sessionId: "5b0c1d2e-0000",
    laneId: "",
    cwd: "/work/acme-api",
    kind: "file_edit",
    files: [],
    summary: "",
    src: { file: "f", line: 1 },
    ...p,
  };
}

describe("mergeResults", () => {
  const results: ParseResult[] = [
    {
      events: [
        ev({ id: "a", tsMs: 300, files: ["/work/acme-api/src/db.ts"] }),
        ev({ id: "b", tsMs: 100, files: ["/work/acme-api/src/a.ts", "/tmp/outside.txt"] }),
        ev({ id: "c", tsMs: 50, cwd: "/work/other" }),
        ev({ id: "d", tsMs: 5, files: ["/work/acme-api/old.ts"] }),
      ],
      usage: [
        { tsMs: 100, cwd: "/work/acme-api", agent: "claude", model: "m", tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } },
        { tsMs: 100, cwd: "/work/other", agent: "claude", model: "m", tokens: { input: 9, output: 9, cacheRead: 0, cacheWrite: 0 } },
      ],
      notes: [],
    },
    {
      events: [
        ev({
          id: "e",
          tsMs: 100,
          agent: "codex",
          sessionId: "01a0e0df-9999",
          cwd: "/work/acme-api-wt/src",
          files: ["/work/acme-api-wt/src/db.ts"],
        }),
        ev({ id: "f", tsMs: 200, subagent: { id: "a1b2c3d4", type: "Explore" }, kind: "tool_call" }),
      ],
      usage: [],
      notes: [],
    },
  ];
  const m = mergeResults(results, target, 10);

  it("filters by repo and since, sorts by time then lane", () => {
    expect(m.events.map((e) => e.id)).toEqual(["b", "e", "f", "a"]);
  });

  it("relativizes files per worktree and flags outside files", () => {
    const byId = Object.fromEntries(m.events.map((e) => [e.id, e]));
    expect(byId.b!.files).toEqual(["src/a.ts", "/tmp/outside.txt"]);
    expect(byId.b!.outsideRepo).toBe(true);
    expect(byId.a!.outsideRepo).toBeUndefined();
    expect(byId.e!.files).toEqual(["src/db.ts"]);
  });

  it("assigns lanes with labels", () => {
    expect(m.lanes.map((l) => [l.id, l.label, l.eventCount])).toEqual([
      ["claude:5b0c1d2e-0000", "claude 5b0c1d2e", 2],
      ["codex:01a0e0df-9999@wt-feature", "codex 01a0e0df @wt-feature", 1],
      ["claude:5b0c1d2e-0000:a1b2c3d4", "claude 5b0c1d2e > Explore a1b2", 1],
    ]);
    expect(m.lanes[0]).toMatchObject({ firstMs: 100, lastMs: 300 });
  });

  it("keeps only in-repo usage records", () => {
    expect(m.usage).toHaveLength(1);
    expect(m.usage[0]!.tokens.input).toBe(1);
  });

  it("labels subagents without a type", () => {
    expect(laneLabel({ agent: "claude", sessionId: "abcdefgh12", subagent: { id: "zz99" } })).toBe(
      "claude abcdefgh > subagent zz99",
    );
  });
});
