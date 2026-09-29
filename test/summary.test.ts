import { describe, expect, it } from "vitest";
import { sanitizeTerminal, summaryLines } from "../src/summary.js";
import type { ReportData } from "../src/schema.js";

describe("summary", () => {
  it("strips control characters from terminal output", () => {
    const esc = String.fromCharCode(27);
    const bel = String.fromCharCode(7);
    const csi = String.fromCharCode(0x9b);
    expect(sanitizeTerminal(`a${esc}]0;owned${bel}b${csi}2Jc\r\nd`)).toBe("a?]0;owned?b?2Jc??d");
    const data = {
      repo: { root: `/work/x${esc}[2J`, worktrees: [] },
      range: { sinceMs: null, firstMs: 0, lastMs: 0 },
      options: { windowMs: 1, loopThreshold: 4, redacted: false },
      sources: { claudeDir: "/c", codexDir: null },
      stats: { claudeSessions: 0, claudeSubagents: 0, claudeEvents: 0, codexSessions: 0, codexEvents: 0, filesScanned: 1 },
      events: [],
      warnings: [],
      notes: [`codex: unrecognized rollout format in f (cli_version 1${esc}]8;;x${bel})`],
    } as unknown as ReportData;
    const lines = summaryLines(data, null);
    for (const l of lines) expect(l).not.toMatch(/[\x00-\x1f\x7f-\x9f]/);
    expect(lines.join("\n")).toContain("cli_version 1?]8;;x?");
  });
});
