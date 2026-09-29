import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseClaudeFile } from "../src/parsers/claude.js";
import { parseCodexFile } from "../src/parsers/codex.js";
import { SECRET_MASK, scrubSecrets } from "../src/redact.js";
import { renderHtml } from "../src/report/html.js";
import type { ReportData } from "../src/schema.js";

// Synthetic token-shaped values, assembled at runtime so no token-looking literal sits in the repo.
const rep = (c: string, n: number) => c.repeat(n);
const FAKE = {
  openai: "sk-" + "proj" + rep("A1b2", 6),
  anthropic: "sk-" + "ant-api03-" + rep("Xy9_", 8),
  ghp: "gh" + "p_" + rep("a1B2", 9),
  gho: "gh" + "o_" + rep("Q7z", 8),
  pat: "github" + "_pat_" + rep("11AB_cd", 5),
  aws: "AK" + "IA" + rep("Z3", 8),
  slack: "xo" + "xb-" + "1234-5678-" + rep("abc", 6),
  google: "AI" + "za" + rep("Sy0_", 8) + "abc",
  bearer: rep("eyJhbGci", 4),
};

describe("scrubSecrets", () => {
  it.each(Object.entries(FAKE).filter(([k]) => k !== "bearer"))("masks %s tokens", (_k, token) => {
    const out = scrubSecrets(`before ${token} after`);
    expect(out).toBe(`before ${SECRET_MASK} after`);
  });

  it("masks Authorization headers and bare Bearer tokens", () => {
    expect(scrubSecrets(`curl -H "Authorization: Bearer ${FAKE.bearer}" https://api.example`)).toBe(
      `curl -H "Authorization: Bearer ${SECRET_MASK}" https://api.example`,
    );
    expect(scrubSecrets(`authorization: basic ${FAKE.bearer}`)).toBe(`authorization: basic ${SECRET_MASK}`);
    expect(scrubSecrets(`use Bearer ${FAKE.bearer} here`)).toBe(`use Bearer ${SECRET_MASK} here`);
  });

  it("masks secret-looking assignments but keeps the name", () => {
    expect(scrubSecrets("export OPENAI_API_KEY=abc123def && npm test")).toBe(`export OPENAI_API_KEY=${SECRET_MASK} && npm test`);
    expect(scrubSecrets("DB_PASSWORD='hunter two' GH_TOKEN=xyz api-key=q secret=\"s p\"")).toBe(
      `DB_PASSWORD=${SECRET_MASK} GH_TOKEN=${SECRET_MASK} api-key=${SECRET_MASK} secret=${SECRET_MASK}`,
    );
    expect(scrubSecrets("NODE_ENV=test PORT=3000 npm start")).toBe("NODE_ENV=test PORT=3000 npm start");
  });

  it("masks PEM private keys including the body", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(scrubSecrets(`echo "${pem}" > k`)).toBe(`echo "${SECRET_MASK}" > k`);
    expect(scrubSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nabc (truncated")).toBe(SECRET_MASK);
  });

  it("leaves ordinary text alone", () => {
    const s = "npm test -- db && git commit -m 'fix task-runner disk-usage' --author=me";
    expect(scrubSecrets(s)).toBe(s);
  });

  it("stays fast on adversarial input", () => {
    const inputs = [rep("a", 200_000), rep("a=", 100_000), rep(" ", 200_000) + "x", "Bearer " + rep(" ", 200_000), rep("-----BEGIN ", 20_000)];
    const t0 = performance.now();
    for (const s of inputs) scrubSecrets(s);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe("secrets are scrubbed at parse time (without --redact)", () => {
  it("claude and codex prompts and commands", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rig-secret-"));
    const claude = path.join(dir, "s.jsonl");
    const base = { sessionId: "abcd1234-0000", cwd: "/work/acme-api", timestamp: "2026-09-20T10:00:00Z" };
    await writeFile(
      claude,
      [
        { ...base, type: "user", message: { role: "user", content: `use key ${FAKE.anthropic} please` } },
        {
          ...base,
          type: "assistant",
          message: {
            id: "m1",
            model: "claude-sonnet-5",
            content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: `curl -H "Authorization: Bearer ${FAKE.bearer}" x` } }],
          },
        },
      ]
        .map((l) => JSON.stringify(l))
        .join("\n"),
    );
    const codex = path.join(dir, "rollout-2026-09-20T10-00-00-0a0a0a0a-0000-4000-8000-000000000000.jsonl");
    const env = (type: string, payload: unknown) => JSON.stringify({ timestamp: base.timestamp, type, payload });
    await writeFile(
      codex,
      [
        env("session_meta", { id: "0a0a0a0a-0000-4000-8000-000000000000", cwd: "/work/acme-api", cli_version: "0.157.0" }),
        env("event_msg", { type: "item_completed", item: { type: "UserMessage", content: [{ type: "text", text: `token ${FAKE.ghp}` }] } }),
        env("event_msg", {
          type: "item_completed",
          item: { type: "CommandExecution", command: ["zsh", "-lc", `GITHUB_TOKEN=${FAKE.pat} gh pr list`], exit_code: 0 },
        }),
      ].join("\n"),
    );
    const c = await parseClaudeFile(claude);
    const x = await parseCodexFile(codex);
    const all = JSON.stringify([c.events, x.events]);
    for (const t of [FAKE.anthropic, FAKE.bearer, FAKE.ghp, FAKE.pat]) expect(all).not.toContain(t);
    expect(all).toContain(SECRET_MASK);
    expect(x.events.find((e) => e.kind === "shell")!.command).toBe(`GITHUB_TOKEN=${SECRET_MASK} gh pr list`);
  });
});

describe("renderHtml payload", () => {
  it("does not embed the command field", () => {
    const data = {
      version: 1,
      events: [{ id: "a", kind: "shell", command: "npm run secret-thing", summary: "npm run secret-thing", files: [] }],
    } as unknown as ReportData;
    const html = renderHtml({
      ...data,
      generatedAt: "",
      repo: { root: "/r", worktrees: [] },
      range: { sinceMs: null, firstMs: 0, lastMs: 0 },
      options: { windowMs: 1, loopThreshold: 4, redacted: false },
      sources: { claudeDir: null, codexDir: null },
      stats: { claudeSessions: 0, claudeSubagents: 0, claudeEvents: 0, codexSessions: 0, codexEvents: 0, filesScanned: 0 },
      lanes: [],
      warnings: [],
      tokens: { byModel: {} },
      cost: { lines: [], totalUsd: 0, priceTable: { asOf: "x", currency: "USD", models: [] }, source: "built-in" },
      notes: [],
    });
    expect(html).not.toContain('"command"');
    expect(html).toContain('"summary":"npm run secret-thing"');
  });
});
