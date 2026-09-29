import { describe, expect, it } from "vitest";
import { findLoops, isReadOnly, normalizeCommand } from "../src/heuristics/loops.js";
import type { Lane, RigEvent } from "../src/schema.js";

const lanes: Lane[] = [{ id: "L", agent: "codex", sessionId: "s", label: "codex s", firstMs: 0, lastMs: 0, eventCount: 0 }];
let n = 0;
function sh(tsMs: number, command: string, extra: Partial<RigEvent> = {}): RigEvent {
  return {
    id: `s${++n}`,
    tsMs,
    agent: "codex",
    sessionId: "s",
    laneId: "L",
    cwd: "/r",
    kind: "shell",
    files: [],
    command,
    summary: command,
    src: { file: "f", line: 1 },
    ...extra,
  };
}
function ed(tsMs: number, file: string, extra: Partial<RigEvent> = {}): RigEvent {
  return { ...sh(tsMs, ""), kind: "file_edit", command: undefined, files: [file], ...extra };
}
const MIN = 60_000;

describe("normalizeCommand / isReadOnly", () => {
  it("normalizes", () => {
    expect(normalizeCommand("  cd /work/x &&   npm   test ")).toBe("npm test");
    expect(normalizeCommand('cd "a b" && cd c && make')).toBe("make");
  });
  it("detects read-only commands", () => {
    expect(isReadOnly(sh(0, "x"), "git status --short")).toBe(true);
    expect(isReadOnly(sh(0, "x"), "sed -n 1,5p f")).toBe(true);
    expect(isReadOnly(sh(0, "x"), "sed -i s/a/b/ f")).toBe(false);
    expect(isReadOnly(sh(0, "x", { parsedTypes: ["read", "search"] }), "custom")).toBe(true);
    expect(isReadOnly(sh(0, "x", { parsedTypes: ["read", "unknown"] }), "custom")).toBe(false);
  });
});

describe("findLoops", () => {
  it("honors the threshold boundary", () => {
    const three = [0, 1, 2].map((i) => sh(i * MIN, "npm test"));
    expect(findLoops(three, lanes, 4)).toEqual([]);
    expect(findLoops(three, lanes, 3)).toHaveLength(1);
  });

  it("requires repeats within the 30m span", () => {
    const spread = [0, 11, 22, 33].map((m) => sh(m * MIN, "npm test"));
    expect(findLoops(spread, lanes, 4)).toEqual([]);
    const tight = [0, 10, 20, 30].map((m) => sh(m * MIN, "npm test"));
    expect(findLoops(tight, lanes, 4)).toHaveLength(1);
  });

  it("computes severity from failures and ignores read-only commands", () => {
    const evs = [
      ...[0, 1, 2, 3].map((m, i) => sh(m * MIN, "cd /r && npm test", { ok: i === 0 })),
      ...[0, 1, 2, 3, 4].map((m) => sh(m * MIN, "git status")),
    ];
    const ws = findLoops(evs, lanes, 4);
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({ kind: "loop-shell", severity: "high", detail: "codex s ran it 4x in 3m, 3 failed" });
    const ok = findLoops([0, 1, 2, 3].map((m) => sh(m * MIN, "npm test", { ok: true })), lanes, 4);
    expect(ok[0]!.severity).toBe("low");
  });

  it("splits separate episodes", () => {
    const evs = [0, 1, 2, 3, 120, 121, 122, 123].map((m) => sh(m * MIN, "make"));
    expect(findLoops(evs, lanes, 4)).toHaveLength(2);
  });

  it("detects edit loops and upgrades on identical edits", () => {
    const plain = [0, 1, 2, 3].map((m) => ed(m * MIN, "a.ts", { editHash: `h${m}` }));
    expect(findLoops(plain, lanes, 4)[0]).toMatchObject({ kind: "loop-edit", severity: "low", file: "a.ts" });
    const same = [0, 1, 2, 3].map((m) => ed(m * MIN, "a.ts", { editHash: m % 2 ? "x" : "y" }));
    const w = findLoops(same, lanes, 4)[0]!;
    expect(w.severity).toBe("high");
    expect(w.detail).toBe("codex s edited it 4x in 3m, 2 identical edits (edits observed in logs)");
  });

  it("ignores failed and outside-repo edits", () => {
    const evs = [0, 1, 2, 3].map((m) => ed(m * MIN, m === 0 ? "/abs/a.ts" : "a.ts"));
    expect(findLoops(evs, lanes, 4)).toEqual([]);
    const failed = [0, 1, 2, 3].map((m) => ed(m * MIN, "a.ts", { ok: m === 0 ? false : true }));
    expect(findLoops(failed, lanes, 4)).toEqual([]);
  });
});
