import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { parseDuration, parseSince } from "./time.js";

export const RawOptionsSchema = z.object({
  repo: z.string().optional(),
  since: z.string().default("7d"),
  out: z.string().optional(),
  json: z.boolean().default(false),
  window: z.string().default("10m"),
  loopThreshold: z.union([z.string(), z.number()]).default("4"),
  claudeDir: z.string().optional(),
  codexDir: z.string().optional(),
  claude: z.boolean().default(true),
  codex: z.boolean().default(true),
  prices: z.string().optional(),
  redact: z.boolean().default(false),
  now: z.string().optional(),
});

export type RawOptions = z.input<typeof RawOptionsSchema>;

export interface ResolvedOptions {
  /** Absolute path given by --repo (or cwd); the repo root is resolved later in repo.ts. */
  repo: string;
  sinceMs: number | null;
  nowMs: number;
  windowMs: number;
  loopThreshold: number;
  /** Claude projects dir, or null when --no-claude. */
  claudeDir: string | null;
  /** Codex home (sessions/ is appended during discovery), or null when --no-codex. */
  codexDir: string | null;
  pricesFile?: string;
  redact: boolean;
  json: boolean;
  /** Output file path; null means stdout (only with --json and no --out). */
  out: string | null;
}

export interface Env {
  cwd: string;
  home: string;
  vars: Record<string, string | undefined>;
  nowMs: number;
}

export function defaultEnv(): Env {
  return { cwd: process.cwd(), home: homedir(), vars: process.env, nowMs: Date.now() };
}

export class OptionsError extends Error {}

export function resolveOptions(raw: RawOptions, env: Env = defaultEnv()): ResolvedOptions {
  const parsed = RawOptionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OptionsError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const o = parsed.data;
  const wrap = <T>(fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      throw new OptionsError((e as Error).message);
    }
  };

  let nowMs = env.nowMs;
  if (o.now !== undefined) {
    nowMs = Date.parse(o.now);
    if (Number.isNaN(nowMs)) throw new OptionsError(`invalid --now "${o.now}"`);
  }

  const sinceMs = wrap(() => parseSince(o.since, nowMs));
  const windowMs = wrap(() => parseDuration(o.window));
  if (windowMs <= 0) throw new OptionsError("--window must be greater than 0");

  const lt = typeof o.loopThreshold === "number" ? o.loopThreshold : Number(o.loopThreshold);
  if (!Number.isInteger(lt) || lt < 2) {
    throw new OptionsError(`--loop-threshold must be an integer >= 2 (got "${o.loopThreshold}")`);
  }

  const abs = (p: string) => path.resolve(env.cwd, p);

  let claudeDir: string | null = null;
  if (o.claude) {
    if (o.claudeDir) claudeDir = abs(o.claudeDir);
    else if (env.vars.CLAUDE_CONFIG_DIR) claudeDir = path.join(abs(env.vars.CLAUDE_CONFIG_DIR), "projects");
    else claudeDir = path.join(env.home, ".claude", "projects");
  }

  let codexDir: string | null = null;
  if (o.codex) {
    if (o.codexDir) codexDir = abs(o.codexDir);
    else if (env.vars.CODEX_HOME) codexDir = abs(env.vars.CODEX_HOME);
    else codexDir = path.join(env.home, ".codex");
  }

  let out: string | null;
  if (o.out) out = abs(o.out);
  else if (o.json) out = null;
  else out = abs("rig-replay-report.html");

  return {
    repo: abs(o.repo ?? env.cwd),
    sinceMs,
    nowMs,
    windowMs,
    loopThreshold: lt,
    claudeDir,
    codexDir,
    pricesFile: o.prices ? abs(o.prices) : undefined,
    redact: o.redact,
    json: o.json,
    out,
  };
}
