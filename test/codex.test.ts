import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commandText, parseCodexFile } from "../src/parsers/codex.js";

const DAY = path.join(import.meta.dirname, "fixtures", "codex", "sessions", "2026", "09", "20");
const CURRENT = path.join(DAY, "rollout-2026-09-20T12-00-00-01a0e0df-1111-4222-8333-444455556666.jsonl");
const LEGACY = path.join(DAY, "rollout-2026-09-20T13-00-00-0b0b0b0b-2222-4333-8444-555566667777.jsonl");
const UNKNOWN = path.join(DAY, "rollout-2026-09-20T14-00-00-0c0c0c0c-3333-4444-8555-666677778888.jsonl");

describe("parseCodexFile (current format)", async () => {
  const r = await parseCodexFile(CURRENT, { srcLabel: "codex/current.jsonl" });

  it("matches snapshot", () => {
    expect(r).toMatchSnapshot();
  });

  it("token deltas sum to the final total_token_usage", () => {
    const sum = r.usage.reduce(
      (a, u) => ({ input: a.input + u.tokens.input, output: a.output + u.tokens.output, cached: a.cached + u.tokens.cacheRead }),
      { input: 0, output: 0, cached: 0 },
    );
    expect(sum).toEqual({ input: 30000, output: 1000, cached: 24000 });
    const attached = r.events.reduce((a, e) => a + (e.tokens?.input ?? 0), 0);
    expect(attached).toBe(30000 - 5000); // the last delta has no following action event
  });

  it("attributes deltas to the current turn_context model", () => {
    expect(r.usage.map((u) => u.model)).toEqual(["gpt-example-5", "gpt-example-5", "gpt-example-5-mini"]);
  });

  it("yields zero events from response_item lines", async () => {
    const lines = (await readFile(CURRENT, "utf8")).split("\n");
    for (const e of r.events) {
      expect(JSON.parse(lines[e.src.line - 1]!).type).toBe("event_msg");
    }
  });

  it("extracts commands, file changes and prompts", () => {
    expect(r.events.map((e) => [e.kind, e.summary, e.ok])).toEqual([
      ["prompt", "fix the flaky db test", undefined],
      ["shell", "npm test -- db", false],
      ["shell", "cat src/db.ts", true],
      ["file_edit", "FileChange: 2 update, 1 add, 1 move", true],
      ["shell", "npm run build", true],
    ]);
    const fc = r.events.find((e) => e.kind === "file_edit")!;
    expect(fc.files).toEqual([
      "/work/acme-api/src/db.ts",
      "/work/acme-api/src/db.helpers.ts",
      "/work/acme-api/src/old-name.ts",
      "/work/acme-api/src/new-name.ts",
    ]);
    expect(r.events[2]!.parsedTypes).toEqual(["read"]);
    expect(r.events.every((e) => e.sessionId === "01a0e0df-1111-4222-8333-444455556666")).toBe(true);
  });

  it("notes unknown line types but nothing else", () => {
    expect(r.notes).toEqual(["codex/current.jsonl: 1 line(s) of unknown type skipped"]);
  });
});

describe("parseCodexFile (legacy format)", async () => {
  const r = await parseCodexFile(LEGACY, { srcLabel: "codex/legacy.jsonl" });

  it("matches snapshot", () => {
    expect(r).toMatchSnapshot();
  });

  it("resolves apply_patch paths relative to cwd, keeps absolute ones, includes Move to", () => {
    const patches = r.events.filter((e) => e.tool === "apply_patch");
    expect(patches[0]!.files).toEqual([
      "/work/acme-api/src/config.ts",
      "/work/acme-api/src/config/load.ts",
      "/work/acme-api/src/config/index.ts",
      "/work/acme-api/src/old-config.ts",
    ]);
    expect(patches[1]!.files).toEqual(["/work/acme-api/README.md"]);
  });

  it("parses legacy shell calls and their exit codes", () => {
    const shells = r.events.filter((e) => e.kind === "shell");
    expect(shells.map((e) => [e.command, e.ok, e.cwd])).toEqual([
      ["npm test", false, "/work/acme-api"],
      ["git status", undefined, "/work/acme-api/src"],
    ]);
    expect(r.events[0]).toMatchObject({ kind: "prompt", summary: "rename the config loader" });
    expect(r.notes).toEqual([]);
  });
});

describe("parseCodexFile (unknown / broken formats)", () => {
  it("emits exactly one format note for an unrecognized rollout", async () => {
    const r = await parseCodexFile(UNKNOWN, { srcLabel: "codex/unknown.jsonl" });
    expect(r.events).toEqual([]);
    expect(r.notes).toEqual([
      "codex: unrecognized rollout format in codex/unknown.jsonl (cli_version 9.9.0); nothing extracted",
    ]);
  });

  it("treats a file without session_meta as unrecognized", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rig-codex-"));
    const f = path.join(dir, "rollout-x.jsonl");
    await writeFile(
      f,
      JSON.stringify({ timestamp: "2026-09-20T10:00:00Z", type: "event_msg", payload: { type: "user_message", message: "hi" } }) +
        "\n",
    );
    const r = await parseCodexFile(f, { srcLabel: "x" });
    expect(r.events).toEqual([]);
    expect(r.notes).toEqual(["codex: unrecognized rollout format in x (cli_version unknown); nothing extracted"]);
  });
});

describe("commandText", () => {
  it("unwraps shell -lc / -c and joins other arrays", () => {
    expect(commandText(["zsh", "-lc", " npm test "])).toBe("npm test");
    expect(commandText(["bash", "-c", "ls"])).toBe("ls");
    expect(commandText(["npm", "run", "build"])).toBe("npm run build");
    expect(commandText("git status")).toBe("git status");
    expect(commandText(42)).toBe("");
  });
});
