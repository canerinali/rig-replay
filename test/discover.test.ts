import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodeClaudeDir, findClaudeFiles, findCodexFiles } from "../src/discover.js";

const FIX = path.join(import.meta.dirname, "fixtures");

describe("discover", () => {
  it("encodes cwd like Claude Code does", () => {
    expect(encodeClaudeDir("/work/acme-api")).toBe("-work-acme-api");
    expect(encodeClaudeDir("/work/acme.api/.wt")).toBe("-work-acme-api--wt");
  });

  it("finds sessions and subagents for the repo only", async () => {
    const files = await findClaudeFiles(path.join(FIX, "claude", "projects"), ["/work/acme-api"], null);
    const got = files.map((f) => [f.label, f.subagent]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(got).toEqual(
      [
        [path.join("claude", "-work-acme-api", "5b0c1d2e-aaaa-4bbb-8ccc-000000000001.jsonl"), undefined],
        [
          path.join("claude", "-work-acme-api", "5b0c1d2e-aaaa-4bbb-8ccc-000000000001", "subagents", "agent-a1b2c3d4e5f6.jsonl"),
          { id: "a1b2c3d4e5f6", type: "Explore" },
        ],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it("returns nothing for missing roots", async () => {
    expect(await findClaudeFiles(path.join(FIX, "nope"), ["/work/acme-api"], null)).toEqual([]);
    expect(await findCodexFiles(path.join(FIX, "nope"), null)).toEqual([]);
  });

  it("finds codex rollouts and pre-filters by date folder", async () => {
    const all = await findCodexFiles(path.join(FIX, "codex"), null);
    expect(all).toHaveLength(3);
    // since 2026-09-22: folder 2026/09/20 is older than since minus one day
    expect(await findCodexFiles(path.join(FIX, "codex"), Date.parse("2026-09-22T00:00:00Z"))).toEqual([]);
    // since 2026-09-21: folder 2026/09/20 is kept (one-day slack), mtime is recent
    expect(await findCodexFiles(path.join(FIX, "codex"), Date.parse("2026-09-21T00:00:00Z"))).toHaveLength(3);
  });
});
