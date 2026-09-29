import path from "node:path";
import { describe, expect, it } from "vitest";
import { badLineNotes, newJsonlStats, readJsonl } from "../src/jsonl.js";

const FIX = path.join(import.meta.dirname, "fixtures", "malformed.jsonl");

describe("readJsonl", () => {
  it("yields good lines with line numbers, counts bad lines, never throws", async () => {
    const stats = newJsonlStats();
    const out: { line: number; value: unknown }[] = [];
    for await (const l of readJsonl(FIX, stats)) out.push(l);
    expect(out).toEqual([
      { line: 1, value: { a: 1 } },
      { line: 6, value: { c: [1, 2, 3] } },
    ]);
    expect(stats.badLines).toEqual([3, 4, 7]);
    expect(stats.totalLines).toBe(7);
  });

  it("produces notes with positions only, never content", async () => {
    const stats = newJsonlStats();
    for await (const _ of readJsonl(FIX, stats)) void _;
    const notes = badLineNotes("malformed.jsonl", stats);
    expect(notes).toEqual(["3 bad line(s) skipped: malformed.jsonl:3, malformed.jsonl:4, malformed.jsonl:7"]);
    expect(notes.join(" ")).not.toContain("not json");
  });

  it("caps positions at 5", () => {
    const notes = badLineNotes("f", { badLines: [1, 2, 3, 4, 5, 6, 7], totalLines: 7 });
    expect(notes[0]).toBe("7 bad line(s) skipped: f:1, f:2, f:3, f:4, f:5 (+2 more)");
  });

  it("returns no notes for clean files", () => {
    expect(badLineNotes("f", newJsonlStats())).toEqual([]);
  });
});
