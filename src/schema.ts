import { z } from "zod";

export type Agent = "claude" | "codex";
export type Kind = "prompt" | "tool_call" | "file_edit" | "shell" | "result";

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface SubagentRef {
  id: string;
  type?: string;
}

export interface RigEvent {
  /** `${agent}:${sessionId.slice(0,8)}:${subId ?? "-"}:${line}:${blockIdx}`; stable, used as HTML anchor */
  id: string;
  tsMs: number;
  agent: Agent;
  sessionId: string;
  subagent?: SubagentRef;
  /** Assigned in merge.ts; parsers leave it empty. */
  laneId: string;
  cwd: string;
  kind: Kind;
  tool?: string;
  /** Absolute in parsers; repo-relative after merge (outside-repo files keep absolute form). */
  files: string[];
  outsideRepo?: boolean;
  command?: string;
  /** Codex parsed_cmd types, used to ignore read-only commands in loop detection. */
  parsedTypes?: string[];
  ok?: boolean;
  editHash?: string;
  revertOf?: string;
  summary: string;
  model?: string;
  tokens?: Tokens;
  src: { file: string; line: number };
}

export interface Lane {
  id: string;
  agent: Agent;
  sessionId: string;
  subagent?: SubagentRef;
  worktree?: string;
  label: string;
  firstMs: number;
  lastMs: number;
  eventCount: number;
}

export type WarningKind = "possible-conflict" | "loop-shell" | "loop-edit";

export interface Warning {
  id: string;
  kind: WarningKind;
  severity: "high" | "low";
  title: string;
  detail: string;
  file?: string;
  lanes: string[];
  evidence: string[];
  startMs: number;
  endMs: number;
}

export interface PriceEntry {
  match: string;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

export interface PriceTable {
  asOf: string;
  currency: "USD";
  models: PriceEntry[];
}

export interface CostLine {
  model: string;
  usd: number | null;
  priceKey?: string;
}

export interface ModelTotals {
  byModel: Record<string, Tokens>;
  /** Agent that produced each model's tokens (for cache billing rules). */
  agentByModel: Record<string, Agent>;
}

export interface ReportData {
  version: 1;
  generatedAt: string;
  repo: { root: string; worktrees: string[] };
  range: { sinceMs: number | null; firstMs: number; lastMs: number };
  options: { windowMs: number; loopThreshold: number; redacted: boolean };
  sources: { claudeDir: string | null; codexDir: string | null };
  stats: {
    claudeSessions: number;
    claudeSubagents: number;
    claudeEvents: number;
    codexSessions: number;
    codexEvents: number;
    filesScanned: number;
  };
  lanes: Lane[];
  events: RigEvent[];
  warnings: Warning[];
  tokens: { byModel: Record<string, Tokens> };
  cost: { lines: CostLine[]; totalUsd: number; priceTable: PriceTable; source: string };
  notes: string[];
}

/** One token-usage observation; totals are summed from these (filtered to the repo), not from events. */
export interface UsageRecord {
  tsMs: number;
  cwd: string;
  agent: Agent;
  model: string;
  tokens: Tokens;
}

export interface ParseResult {
  events: RigEvent[];
  usage: UsageRecord[];
  notes: string[];
}

export function emptyTokens(): Tokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

export function addTokens(target: Tokens, add: Tokens): void {
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheWrite += add.cacheWrite;
}

export function addToTotals(totals: ModelTotals, model: string, agent: Agent, t: Tokens): void {
  const cur = totals.byModel[model] ?? emptyTokens();
  addTokens(cur, t);
  totals.byModel[model] = cur;
  totals.agentByModel[model] = agent;
}

export function emptyTotals(): ModelTotals {
  return { byModel: {}, agentByModel: {} };
}

// ---------- Loose zod schemas for the log lines we read ----------

const num = z.number().optional();

export const ClaudeUsageSchema = z
  .object({
    input_tokens: num,
    output_tokens: num,
    cache_read_input_tokens: num,
    cache_creation_input_tokens: num,
  })
  .passthrough();

export const ClaudeContentBlockSchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    tool_use_id: z.string().optional(),
    is_error: z.boolean().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const ClaudeLineSchema = z
  .object({
    type: z.string(),
    timestamp: z.string().optional(),
    sessionId: z.string().optional(),
    cwd: z.string().optional(),
    isSidechain: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    agentId: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        role: z.string().optional(),
        content: z.union([z.string(), z.array(ClaudeContentBlockSchema)]).optional(),
        usage: ClaudeUsageSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const CodexEnvelopeSchema = z
  .object({
    timestamp: z.string().optional(),
    type: z.string(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const CodexUsageSchema = z
  .object({
    input_tokens: num,
    cached_input_tokens: num,
    cache_write_input_tokens: num,
    output_tokens: num,
    reasoning_output_tokens: num,
    total_tokens: num,
  })
  .passthrough();

export const PriceTableSchema = z.object({
  asOf: z.string(),
  currency: z.literal("USD").default("USD"),
  models: z.array(
    z.object({
      match: z.string().min(1),
      inputPerMTok: z.number().nonnegative(),
      outputPerMTok: z.number().nonnegative(),
      cacheReadPerMTok: z.number().nonnegative(),
      cacheWritePerMTok: z.number().nonnegative(),
    }),
  ),
});
