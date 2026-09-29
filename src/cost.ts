import { readFile } from "node:fs/promises";
import { PriceTableSchema, type Agent, type CostLine, type PriceEntry, type PriceTable, type Tokens } from "./schema.js";

/**
 * Built-in price table (USD per million tokens), copied from the vendors' public pricing pages
 * (platform.claude.com/docs/en/about-claude/pricing and developers.openai.com/api/docs/pricing)
 * on the `asOf` date. First matching entry wins, so more specific prefixes come first.
 * `match` is a prefix, or a glob when it contains `*`.
 * Claude cache writes use the 5-minute cache-write price. OpenAI has no separate cache-write
 * price, so it is 0 there (those tokens are already part of Codex `input_tokens`).
 */
export const DEFAULT_PRICES: PriceTable = {
  asOf: "2026-09-29",
  currency: "USD",
  models: [
    { match: "claude-fable-5-1", inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 0.25, cacheWritePerMTok: 12.5 },
    { match: "claude-fable-5", inputPerMTok: 10, outputPerMTok: 50, cacheReadPerMTok: 1, cacheWritePerMTok: 12.5 },
    { match: "claude-opus-5-5", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
    { match: "claude-opus-4-1", inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
    { match: "claude-opus-4-0", inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
    { match: "claude-opus-4-2*", inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWritePerMTok: 18.75 },
    { match: "claude-opus-", inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
    { match: "claude-sonnet-5", inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
    { match: "claude-sonnet-4", inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
    { match: "claude-haiku-4", inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
    { match: "claude-3-5-haiku", inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1 },
    { match: "gpt-5.6-sol", inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.4, cacheWritePerMTok: 0 },
    { match: "gpt-5.5-pro", inputPerMTok: 30, outputPerMTok: 180, cacheReadPerMTok: 30, cacheWritePerMTok: 0 },
    { match: "gpt-5.5", inputPerMTok: 5, outputPerMTok: 30, cacheReadPerMTok: 0.5, cacheWritePerMTok: 0 },
    { match: "gpt-5.4-pro", inputPerMTok: 30, outputPerMTok: 180, cacheReadPerMTok: 30, cacheWritePerMTok: 0 },
    { match: "gpt-5.4-mini", inputPerMTok: 0.75, outputPerMTok: 4.5, cacheReadPerMTok: 0.075, cacheWritePerMTok: 0 },
    { match: "gpt-5.4-nano", inputPerMTok: 0.2, outputPerMTok: 1.25, cacheReadPerMTok: 0.02, cacheWritePerMTok: 0 },
    { match: "gpt-5.4", inputPerMTok: 2.5, outputPerMTok: 15, cacheReadPerMTok: 0.25, cacheWritePerMTok: 0 },
    { match: "gpt-5.3-codex", inputPerMTok: 1.75, outputPerMTok: 14, cacheReadPerMTok: 0.175, cacheWritePerMTok: 0 },
    { match: "gpt-5.2-pro", inputPerMTok: 21, outputPerMTok: 168, cacheReadPerMTok: 21, cacheWritePerMTok: 0 },
    { match: "gpt-5.2", inputPerMTok: 1.75, outputPerMTok: 14, cacheReadPerMTok: 0.175, cacheWritePerMTok: 0 },
    { match: "gpt-5.1", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: 0 },
    { match: "gpt-5-pro", inputPerMTok: 15, outputPerMTok: 120, cacheReadPerMTok: 15, cacheWritePerMTok: 0 },
    { match: "gpt-5-mini", inputPerMTok: 0.25, outputPerMTok: 2, cacheReadPerMTok: 0.025, cacheWritePerMTok: 0 },
    { match: "gpt-5-nano", inputPerMTok: 0.05, outputPerMTok: 0.4, cacheReadPerMTok: 0.005, cacheWritePerMTok: 0 },
    { match: "gpt-5", inputPerMTok: 1.25, outputPerMTok: 10, cacheReadPerMTok: 0.125, cacheWritePerMTok: 0 },
  ],
};

function globToRegExp(glob: string): RegExp {
  const esc = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${esc}$`);
}

export function matchPrice(table: PriceTable, model: string): PriceEntry | undefined {
  return table.models.find((m) => (m.match.includes("*") ? globToRegExp(m.match).test(model) : model.startsWith(m.match)));
}

export async function loadPrices(file: string): Promise<PriceTable> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`cannot read price table ${file}: ${(e as Error).message}`);
  }
  const parsed = PriceTableSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid price table ${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/**
 * Cost of one model's tokens. Claude `input` excludes cache fields, so each is billed separately.
 * Codex `input` includes `cacheRead` (cached_input_tokens): bill `input - cacheRead` at the input price
 * and `cacheRead` at the cache-read price.
 */
export function costFor(price: PriceEntry, t: Tokens, agent: Agent): number {
  const uncached = agent === "codex" ? Math.max(0, t.input - t.cacheRead) : t.input;
  return (
    (uncached * price.inputPerMTok +
      t.output * price.outputPerMTok +
      t.cacheRead * price.cacheReadPerMTok +
      t.cacheWrite * price.cacheWritePerMTok) /
    1_000_000
  );
}

export interface ModelUsage {
  model: string;
  agent: Agent;
  tokens: Tokens;
}

export function estimate(usage: ModelUsage[], table: PriceTable): { lines: CostLine[]; totalUsd: number } {
  const lines: CostLine[] = [];
  let total = 0;
  for (const u of usage) {
    const price = matchPrice(table, u.model);
    if (!price) {
      lines.push({ model: u.model, usd: null });
      continue;
    }
    const usd = costFor(price, u.tokens, u.agent);
    total += usd;
    lines.push({ model: u.model, usd, priceKey: price.match });
  }
  return { lines, totalUsd: total };
}
