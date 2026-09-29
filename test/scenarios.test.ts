import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/index.js";
import { resolveOptions } from "../src/options.js";

const DIR = path.join(import.meta.dirname, "fixtures", "scenarios");

async function run(name: string) {
  const opts = resolveOptions(
    {
      repo: "/work/acme-api",
      since: "all",
      now: "2026-09-21T00:00:00Z",
      claudeDir: path.join(DIR, name, "claude", "projects"),
      codexDir: path.join(DIR, name, "codex"),
      json: true,
    },
    { cwd: DIR, home: "/nonexistent-home", vars: {}, nowMs: 0 },
  );
  return buildReport(opts);
}

describe.each(["true-conflict", "sequential", "parent-subagent"])("scenario %s", (name) => {
  it("produces exactly the labeled warnings", async () => {
    const expected = JSON.parse(readFileSync(path.join(DIR, name, "expected.json"), "utf8")) as unknown[];
    const data = await run(name);
    const got = data.warnings.map((w) => ({ kind: w.kind, severity: w.severity, ...(w.file ? { file: w.file } : {}) }));
    const key = (x: unknown) => JSON.stringify(x);
    expect(got.map(key).sort()).toEqual(expected.map(key).sort());
    expect(data.notes).toEqual([]);
    for (const w of data.warnings) {
      expect(w.evidence.length).toBeGreaterThan(0);
      for (const id of w.evidence) expect(data.events.some((e) => e.id === id)).toBe(true);
    }
  });
});

describe("scenario details", () => {
  it("true-conflict: interleaved A,B,A and a failing loop", async () => {
    const data = await run("true-conflict");
    const pc = data.warnings.find((w) => w.kind === "possible-conflict")!;
    expect(pc.title).toBe("Possible conflict on src/db.ts");
    expect(pc.detail).toBe("claude aaaa1111 and codex bbbb2222 both edited it within 4m, interleaved (edits observed in logs)");
    expect(pc.evidence).toHaveLength(3);
    const loop = data.warnings.find((w) => w.kind === "loop-shell")!;
    expect(loop.detail).toBe("codex bbbb2222 ran it 5x in 8m, 4 failed");
    expect(loop.title).toBe("Repeated command: npm test");
  });

  it("parent-subagent: low severity, same session", async () => {
    const data = await run("parent-subagent");
    const pc = data.warnings.find((w) => w.kind === "possible-conflict")!;
    expect(pc.detail).toContain("same session");
    const le = data.warnings.find((w) => w.kind === "loop-edit")!;
    expect(le.detail).toBe("claude eeee5555 edited it 4x in 6m, 1 revert (edits observed in logs)");
  });
});
