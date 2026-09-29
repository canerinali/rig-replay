import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeFile } from "../src/parsers/claude.js";

const DIR = path.join(import.meta.dirname, "fixtures", "claude", "projects", "-work-acme-api");
const SID = "5b0c1d2e-aaaa-4bbb-8ccc-000000000001";
const MAIN = path.join(DIR, `${SID}.jsonl`);
const SUB = path.join(DIR, SID, "subagents", "agent-a1b2c3d4e5f6.jsonl");

describe("parseClaudeFile (main session)", async () => {
  const r = await parseClaudeFile(MAIN, { srcLabel: "claude/main.jsonl" });

  it("matches snapshot", () => {
    expect(r).toMatchSnapshot();
  });

  it("counts usage once per message.id and skips <synthetic>", () => {
    expect(r.usage.map((u) => u.model)).not.toContain("<synthetic>");
    // msg_01..msg_09 = 9 distinct messages with usage
    expect(r.usage).toHaveLength(9);
    const reads = r.usage.filter((u) => u.cwd === "/work/acme-api");
    expect(reads).toHaveLength(9);
    const totalOut = r.usage.reduce((a, u) => a + u.tokens.output, 0);
    expect(totalOut).toBe(50 + 120 + 80 + 200 + 30 + 60 + 40 + 40 + 40);
  });

  it("attaches tokens of a text-only first line to the next event of the same message", () => {
    const write = r.events.find((e) => e.tool === "Write")!;
    expect(write.tokens).toEqual({ input: 4, output: 200, cacheRead: 14000, cacheWrite: 300 });
    expect(write.model).toBe("claude-example-4");
  });

  it("marks a failed edit ok:false and successful ones ok:true", () => {
    const edits = r.events.filter((e) => e.tool === "Edit");
    const db = edits.find((e) => e.files[0] === "/work/acme-api/src/db.ts")!;
    expect(db.ok).toBe(false);
    expect(edits.find((e) => e.files[0] === "/work/acme-api/src/routes/orders.ts")!.ok).toBe(true);
  });

  it("skips isMeta, <command-, attachments and system lines; keeps array text prompts", () => {
    const prompts = r.events.filter((e) => e.kind === "prompt").map((e) => e.summary);
    expect(prompts).toEqual(["add pagination to the orders endpoint", "also update the README"]);
  });

  it("resolves relative paths against cwd and detects reverts", () => {
    const readmeEdits = r.events.filter((e) => e.files[0] === "/work/acme-api/README.md");
    expect(readmeEdits).toHaveLength(2);
    expect(readmeEdits[1]!.revertOf).toBe(readmeEdits[0]!.id);
  });

  it("maps tools to kinds", () => {
    const byTool = Object.fromEntries(r.events.filter((e) => e.tool).map((e) => [e.tool, e.kind]));
    expect(byTool).toMatchObject({
      Read: "tool_call",
      Edit: "file_edit",
      Write: "file_edit",
      Bash: "shell",
      Agent: "tool_call",
      mcp__github__search_code: "tool_call",
    });
    expect(r.events.find((e) => e.tool === "Agent")!.summary).toBe("spawn Explore: find order queries");
    expect(r.events.find((e) => e.tool === "Bash")!.command).toBe("cd /work/acme-api && npm test");
  });

  it("notes the unknown line type and bad timestamp without failing", () => {
    expect(r.notes).toEqual([
      "claude/main.jsonl: 1 line(s) without a valid timestamp skipped",
      "claude/main.jsonl: 1 line(s) of unknown type skipped",
    ]);
  });

  it("builds stable ids", () => {
    expect(r.events[0]!.id).toBe("claude:5b0c1d2e:-:2:0");
  });
});

describe("parseClaudeFile (subagent)", async () => {
  const r = await parseClaudeFile(SUB, {
    srcLabel: "claude/sub.jsonl",
    subagent: { id: "a1b2c3d4e5f6", type: "Explore" },
  });

  it("matches snapshot", () => {
    expect(r).toMatchSnapshot();
  });

  it("carries the parent session id and subagent type", () => {
    for (const e of r.events) {
      expect(e.sessionId).toBe(SID);
      expect(e.subagent).toEqual({ id: "a1b2c3d4e5f6", type: "Explore" });
      expect(e.id.startsWith("claude:5b0c1d2e:a1b2c3d4e5f6:")).toBe(true);
    }
    expect(r.usage.every((u) => u.model === "claude-small-4")).toBe(true);
    expect(r.notes).toEqual([]);
  });
});

describe("parseClaudeFile (edge cases)", () => {
  it("counts bad lines in a malformed file without throwing", async () => {
    const r = await parseClaudeFile(path.join(import.meta.dirname, "fixtures", "malformed.jsonl"), { srcLabel: "m" });
    expect(r.events).toEqual([]);
    expect(r.notes[0]).toBe("3 bad line(s) skipped: m:3, m:4, m:7");
  });
});
