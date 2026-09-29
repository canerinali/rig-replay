import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES, costFor, estimate, loadPrices, matchPrice } from "../src/cost.js";
import type { PriceTable } from "../src/schema.js";

const table: PriceTable = {
  asOf: "2026-09-29",
  currency: "USD",
  models: [
    { match: "claude-*-4*", inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
    { match: "gpt-5", inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 0 },
  ],
};

describe("cost", () => {
  it("matches by prefix or glob, first match wins", () => {
    expect(matchPrice(table, "claude-sonnet-4-6")?.match).toBe("claude-*-4*");
    expect(matchPrice(table, "gpt-5.3-codex")?.match).toBe("gpt-5");
    expect(matchPrice(table, "mystery-model")).toBeUndefined();
  });

  it("bills Claude cache fields separately from input", () => {
    const usd = costFor(table.models[0]!, { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, "claude");
    expect(usd).toBeCloseTo(3 + 15 + 0.3 + 3.75, 10);
  });

  it("bills Codex cached tokens out of input", () => {
    const usd = costFor(table.models[1]!, { input: 1_000_000, output: 0, cacheRead: 800_000, cacheWrite: 0 }, "codex");
    expect(usd).toBeCloseTo(0.2 * 1 + 0.8 * 0.1, 10);
  });

  it("returns null for unmatched models and sums the rest", () => {
    const r = estimate(
      [
        { model: "gpt-5", agent: "codex", tokens: { input: 2_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
        { model: "nope", agent: "codex", tokens: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0 } },
      ],
      table,
    );
    expect(r.lines).toEqual([
      { model: "gpt-5", usd: 2, priceKey: "gpt-5" },
      { model: "nope", usd: null },
    ]);
    expect(r.totalUsd).toBe(2);
  });

  it("built-in table resolves current model ids to the right entries", () => {
    const key = (m: string) => matchPrice(DEFAULT_PRICES, m)?.match;
    expect(key("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(key("claude-opus-5")).toBe("claude-opus-");
    expect(key("claude-opus-4-1-20250805")).toBe("claude-opus-4-1");
    expect(key("claude-opus-4-20250514")).toBe("claude-opus-4-2*");
    expect(key("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4");
    expect(key("claude-haiku-4-5")).toBe("claude-haiku-4");
    expect(key("gpt-5.3-codex")).toBe("gpt-5.3-codex");
    expect(key("gpt-5.1-codex-max")).toBe("gpt-5.1");
    expect(key("gpt-5-codex")).toBe("gpt-5");
    expect(key("gpt-5-mini")).toBe("gpt-5-mini");
    expect(key("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(DEFAULT_PRICES.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("loads and validates a price file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "rig-prices-"));
    const good = path.join(dir, "p.json");
    await writeFile(good, JSON.stringify(table));
    expect(await loadPrices(good)).toEqual(table);
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, JSON.stringify({ asOf: "x", models: [{ match: "" }] }));
    await expect(loadPrices(bad)).rejects.toThrow(/invalid price table/);
    await expect(loadPrices(path.join(dir, "missing.json"))).rejects.toThrow(/cannot read price table/);
  });
});
