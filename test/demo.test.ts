import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/index.js";
import { resolveOptions } from "../src/options.js";

const DEMO = path.join(import.meta.dirname, "..", "examples", "demo-logs");

describe("demo logs ReportData", () => {
  it("matches snapshot", async () => {
    const data = await buildReport(
      resolveOptions(
        {
          repo: "/work/acme-api",
          since: "all",
          now: "2026-09-21T00:00:00Z",
          claudeDir: path.join(DEMO, "claude", "projects"),
          codexDir: path.join(DEMO, "codex"),
          json: true,
        },
        { cwd: DEMO, home: "/nonexistent-home", vars: {}, nowMs: 0 },
      ),
    );
    // machine-specific absolute source dirs are not part of the snapshot
    expect({ ...data, sources: null }).toMatchSnapshot();
    expect(data.warnings.map((w) => [w.kind, w.severity, w.file])).toEqual([
      ["possible-conflict", "high", "src/db.ts"],
      ["loop-shell", "high", undefined],
    ]);
    expect(data.lanes.map((l) => l.label)).toEqual([
      "claude 5b0c1d2e",
      "claude 5b0c1d2e > Explore a9e3",
      "codex 01a0e0df",
      "claude 7c9d4e1f",
      "codex 0b0b0b0b",
    ]);
    expect(data.cost.lines.every((l) => l.usd !== null)).toBe(true);
  });
});
