import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReport } from "../src/index.js";
import { resolveOptions } from "../src/options.js";
import { redactEvents } from "../src/redact.js";
import { renderHtml } from "../src/report/html.js";
import type { ReportData, RigEvent } from "../src/schema.js";

const DEMO = path.join(import.meta.dirname, "..", "examples", "demo-logs");

function opts(extra: Record<string, unknown> = {}) {
  return resolveOptions(
    {
      repo: "/work/acme-api",
      since: "all",
      now: "2026-09-21T00:00:00Z",
      claudeDir: path.join(DEMO, "claude", "projects"),
      codexDir: path.join(DEMO, "codex"),
      json: true,
      ...extra,
    },
    { cwd: DEMO, home: "/nonexistent-home", vars: {}, nowMs: 0 },
  );
}

function embedded(html: string): ReportData {
  const m = /<script type="application\/json" id="rig-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no rig-data");
  return JSON.parse(m[1]!) as ReportData;
}

describe("renderHtml", async () => {
  const data = await buildReport(opts());
  const html = renderHtml(data);

  it("has no external URLs in src/href/@import/url()", () => {
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/i);
    expect(html).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
  });

  it("embeds the data once and it round-trips", () => {
    expect(html.match(/id="rig-data"/g)).toHaveLength(1);
    const withoutCommand = { ...data, events: data.events.map(({ command: _c, ...e }) => e) };
    expect(embedded(html)).toEqual(JSON.parse(JSON.stringify(withoutCommand)));
    expect(embedded(html).events.some((e) => "command" in e)).toBe(false);
  });

  it("never uses innerHTML in the client script", () => {
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("document.write");
  });

  it("keeps a hostile prompt as inert text", () => {
    const evil = "</script><img src=x onerror=alert(1)><!--";
    const hostile: ReportData = {
      ...data,
      events: [{ ...data.events[0]!, summary: evil }, ...data.events.slice(1)],
      notes: [evil],
    };
    const out = renderHtml(hostile);
    expect(out).not.toContain(evil);
    expect(out).not.toContain("<img src=x");
    expect(embedded(out).events[0]!.summary).toBe(evil);
    expect(embedded(out).notes[0]).toBe(evil);
  });

  it("contains the wording rules", () => {
    expect(html).toContain("edits observed in logs");
    expect(html).toContain("estimated cost");
    expect(html).toContain("not seen");
    expect(html).not.toMatch(/>\s*Conflict/);
  });
});

describe("redaction", () => {
  it("--redact output contains no prompt or command strings from the demo", async () => {
    const plain = await buildReport(opts());
    const secrets = plain.events
      .filter((e) => e.kind === "prompt" || e.kind === "shell")
      .flatMap((e) => [e.summary, e.command ?? ""])
      .filter((s) => s.length > 8);
    expect(secrets.length).toBeGreaterThan(5);
    const red = await buildReport(opts({ redact: true }));
    const html = renderHtml(red);
    for (const s of secrets) {
      expect(html).not.toContain(JSON.stringify(s).slice(1, -1));
    }
    expect(red.options.redacted).toBe(true);
    expect(red.warnings.find((w) => w.kind === "loop-shell")!.title).toMatch(/^Repeated command: \[redacted \d+ chars\]$/);
    // paths are kept
    expect(red.events.some((e) => e.files.includes("src/db.ts"))).toBe(true);
  });

  it("redactEvents keeps tool-name summaries", () => {
    const e = { kind: "tool_call", tool: "Read", summary: "Read", files: ["a"] } as RigEvent;
    expect(redactEvents([e])[0]!.summary).toBe("Read");
    const spawn = { kind: "tool_call", tool: "Agent", summary: "spawn Explore: secret plan", files: [] } as unknown as RigEvent;
    expect(redactEvents([spawn])[0]!.summary).toBe("[redacted 26 chars]");
  });
});
