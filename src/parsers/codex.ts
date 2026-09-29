import path from "node:path";
import { badLineNotes, newJsonlStats, readJsonl } from "../jsonl.js";
import {
  CodexEnvelopeSchema,
  CodexUsageSchema,
  addTokens,
  emptyTokens,
  type ParseResult,
  type RigEvent,
  type Tokens,
  type UsageRecord,
} from "../schema.js";
import { parseTs } from "../time.js";
import { scrubSecrets } from "../redact.js";
import { oneLine, sha1 } from "../util.js";

const MAX_TEXT = 4000;
const promptText = (s: string) => oneLine(scrubSecrets(s.slice(0, MAX_TEXT)), 200);
import { extractPatchPaths, type PatchOp } from "./applyPatch.js";

export interface CodexParseOptions {
  /** Label used in evidence pointers (e.g. "codex/2026/09/20/rollout-....jsonl"); defaults to the file path. */
  srcLabel?: string;
}

const LEGACY_SHELL_TOOLS = new Set(["shell", "exec_command", "shell_command", "container.exec"]);
const KNOWN_TYPES = new Set([
  "session_meta",
  "turn_context",
  "response_item",
  "event_msg",
  "token_usage_record",
  "world_state",
  "compacted",
]);
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | undefined {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** `[<shell>, "-lc"|"-c", <script>]` -> script; other arrays are joined; strings are kept. */
export function commandText(command: unknown): string {
  if (typeof command === "string") return command.trim();
  if (Array.isArray(command) && command.every((c) => typeof c === "string")) {
    const parts = command as string[];
    if (parts.length === 3 && (parts[1] === "-lc" || parts[1] === "-c")) return parts[2]!.trim();
    return parts.join(" ").trim();
  }
  return "";
}

interface Cumulative {
  tokens: Tokens;
  total: number;
}

function codexUsage(v: unknown): Cumulative | undefined {
  const p = CodexUsageSchema.safeParse(v);
  if (!p.success) return undefined;
  const u = p.data;
  const tokens: Tokens = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cached_input_tokens ?? 0,
    cacheWrite: u.cache_write_input_tokens ?? 0,
  };
  const total = u.total_tokens ?? tokens.input + tokens.output;
  return { tokens, total };
}

function opSummary(tool: string, ops: PatchOp[]): string {
  const counts = new Map<PatchOp, number>();
  for (const o of ops) counts.set(o, (counts.get(o) ?? 0) + 1);
  const parts = [...counts].map(([op, n]) => `${n} ${op}`);
  return `${tool}: ${parts.join(", ") || "no files"}`;
}

export async function parseCodexFile(file: string, opts: CodexParseOptions = {}): Promise<ParseResult> {
  const label = opts.srcLabel ?? file;
  const stats = newJsonlStats();
  const notes: string[] = [];
  const itemEvents: RigEvent[] = [];
  const legacyEvents: RigEvent[] = [];
  const legacyCalls = new Map<string, RigEvent>();
  const deltas: { line: number; tsMs: number; cwd: string; model: string; tokens: Tokens }[] = [];

  let hasMeta = false;
  let hasItems = false;
  let sessionId = UUID_RE.exec(path.basename(file))?.[0] ?? path.basename(file, ".jsonl");
  let cliVersion = "unknown";
  let cwd = "";
  let model = "unknown";
  let last: Cumulative | undefined;
  let badShape = 0;
  let unknownTypes = 0;
  let noTimestamp = 0;
  let lineTotal = 0;

  const makeEvent = (
    line: number,
    tsMs: number,
    evCwd: string,
    rest: Omit<RigEvent, "id" | "tsMs" | "agent" | "sessionId" | "laneId" | "cwd" | "src">,
  ): RigEvent => ({
    id: `codex:${sessionId.slice(0, 8)}:-:${line}:0`,
    tsMs,
    agent: "codex",
    sessionId,
    laneId: "",
    cwd: evCwd,
    ...rest,
    src: { file: label, line },
  });

  const resolveIn = (base: string, p: string) =>
    path.isAbsolute(p) ? path.normalize(p) : path.resolve(base || "/", p);

  for await (const { line, value } of readJsonl(file, stats)) {
    lineTotal = line;
    const env = CodexEnvelopeSchema.safeParse(value);
    if (!env.success) {
      badShape++;
      continue;
    }
    const { type } = env.data;
    const payload = env.data.payload ?? {};
    if (!KNOWN_TYPES.has(type)) {
      unknownTypes++;
      continue;
    }
    const tsMs = parseTs(env.data.timestamp);

    if (type === "session_meta") {
      hasMeta = true;
      const id = str(payload.id) ?? str(payload.session_id);
      if (id) sessionId = id;
      cliVersion = str(payload.cli_version) ?? cliVersion;
      cwd = str(payload.cwd) ?? cwd;
      continue;
    }
    if (type === "turn_context") {
      cwd = str(payload.cwd) ?? cwd;
      model = str(payload.model) ?? model;
      continue;
    }
    if (Number.isNaN(tsMs)) {
      if (type === "event_msg" || type === "response_item") noTimestamp++;
      continue;
    }

    if (type === "event_msg") {
      const ptype = str(payload.type);
      if (ptype === "item_completed") {
        hasItems = true;
        const item = obj(payload.item);
        const itype = str(item?.type);
        if (!item || !itype) {
          badShape++;
          continue;
        }
        if (itype === "CommandExecution") {
          const evCwd = str(item.cwd) ?? cwd;
          const command = scrubSecrets(commandText(item.command).slice(0, 500));
          const exit = item.exit_code;
          let ok: boolean | undefined;
          if (typeof exit === "number") ok = exit === 0;
          else if (item.status === "failed") ok = false;
          const parsedTypes = Array.isArray(item.parsed_cmd)
            ? item.parsed_cmd.map((p) => str(obj(p)?.type) ?? "unknown")
            : undefined;
          itemEvents.push(
            makeEvent(line, tsMs, evCwd, {
              kind: "shell",
              tool: "CommandExecution",
              files: [],
              command,
              ...(parsedTypes ? { parsedTypes } : {}),
              ...(ok !== undefined ? { ok } : {}),
              summary: oneLine(command, 200),
            }),
          );
        } else if (itype === "FileChange") {
          const changes = obj(item.changes) ?? {};
          const files: string[] = [];
          const ops: PatchOp[] = [];
          for (const [p, ch] of Object.entries(changes)) {
            const c = obj(ch);
            files.push(resolveIn(cwd, p));
            const t = str(c?.type);
            ops.push(t === "add" || t === "delete" || t === "update" ? t : "update");
            const mv = str(c?.move_path);
            if (mv) {
              files.push(resolveIn(cwd, mv));
              ops.push("move");
            }
          }
          const status = str(item.status);
          const ok = status === undefined ? undefined : status === "completed";
          itemEvents.push(
            makeEvent(line, tsMs, cwd, {
              kind: "file_edit",
              tool: "FileChange",
              files,
              ...(ok !== undefined ? { ok } : {}),
              editHash: sha1(`FileChange\u0000${JSON.stringify(changes)}`),
              summary: opSummary("FileChange", ops),
            }),
          );
        } else if (itype === "UserMessage") {
          const content = Array.isArray(item.content) ? item.content : [];
          const text = content
            .map((c) => (obj(c)?.type === "text" ? str(obj(c)?.text) : undefined))
            .filter((t): t is string => !!t)
            .join(" ");
          if (text.trim()) {
            itemEvents.push(makeEvent(line, tsMs, cwd, { kind: "prompt", files: [], summary: promptText(text) }));
          }
        }
        continue;
      }
      if (ptype === "token_count") {
        const info = obj(payload.info);
        if (!info) continue;
        const cur = codexUsage(info.total_token_usage);
        if (!cur) continue;
        let delta: Tokens;
        if (!last || cur.total < last.total) {
          delta = { ...cur.tokens };
        } else {
          delta = {
            input: Math.max(0, cur.tokens.input - last.tokens.input),
            output: Math.max(0, cur.tokens.output - last.tokens.output),
            cacheRead: Math.max(0, cur.tokens.cacheRead - last.tokens.cacheRead),
            cacheWrite: Math.max(0, cur.tokens.cacheWrite - last.tokens.cacheWrite),
          };
        }
        last = cur;
        if (delta.input + delta.output + delta.cacheRead + delta.cacheWrite > 0) {
          deltas.push({ line, tsMs, cwd, model, tokens: delta });
        }
        continue;
      }
      if (ptype === "user_message") {
        const text = str(payload.message) ?? "";
        if (text.trim()) {
          legacyEvents.push(makeEvent(line, tsMs, cwd, { kind: "prompt", files: [], summary: promptText(text) }));
        }
      }
      continue;
    }

    if (type === "response_item") {
      const ptype = str(payload.type);
      const name = str(payload.name);
      const callId = str(payload.call_id);
      if (ptype === "function_call" && name && LEGACY_SHELL_TOOLS.has(name)) {
        let args: Obj = {};
        try {
          args = obj(JSON.parse(str(payload.arguments) ?? "{}")) ?? {};
        } catch {
          badShape++;
          continue;
        }
        const evCwd = str(args.workdir) ?? cwd;
        const command = scrubSecrets(commandText(args.command ?? args.cmd).slice(0, 500));
        const ev = makeEvent(line, tsMs, evCwd, {
          kind: "shell",
          tool: name,
          files: [],
          command,
          summary: oneLine(command, 200),
        });
        legacyEvents.push(ev);
        if (callId) legacyCalls.set(callId, ev);
        continue;
      }
      let patchText: string | undefined;
      if (ptype === "custom_tool_call" && name === "apply_patch") {
        patchText = str(payload.input);
      } else if (ptype === "function_call" && name === "apply_patch") {
        try {
          patchText = str(obj(JSON.parse(str(payload.arguments) ?? "{}"))?.input);
        } catch {
          badShape++;
          continue;
        }
      }
      if (patchText !== undefined) {
        const touched = extractPatchPaths(patchText);
        const ev = makeEvent(line, tsMs, cwd, {
          kind: "file_edit",
          tool: "apply_patch",
          files: touched.map((t) => resolveIn(cwd, t.path)),
          editHash: sha1(`apply_patch\u0000${patchText}`),
          summary: opSummary("apply_patch", touched.map((t) => t.op)),
        });
        legacyEvents.push(ev);
        if (callId) legacyCalls.set(callId, ev);
        continue;
      }
      if ((ptype === "function_call_output" || ptype === "custom_tool_call_output") && callId) {
        const ev = legacyCalls.get(callId);
        if (!ev) continue;
        const out = payload.output;
        let parsed: Obj | undefined;
        if (typeof out === "string") {
          try {
            parsed = obj(JSON.parse(out));
          } catch {
            parsed = undefined;
          }
        } else {
          parsed = obj(out);
        }
        const exit = obj(parsed?.metadata)?.exit_code;
        if (typeof exit === "number") ev.ok = exit === 0;
        legacyCalls.delete(callId);
      }
    }
  }

  notes.push(...badLineNotes(label, stats));
  if (badShape) notes.push(`${label}: ${badShape} line(s) with unexpected shape skipped`);
  if (noTimestamp) notes.push(`${label}: ${noTimestamp} line(s) without a valid timestamp skipped`);
  if (unknownTypes) notes.push(`${label}: ${unknownTypes} line(s) of unknown type skipped`);

  const events = hasItems ? itemEvents : legacyEvents;
  const recognized = events.length;
  if (!hasMeta || (lineTotal >= 20 && recognized === 0)) {
    notes.push(`codex: unrecognized rollout format in ${label} (cli_version ${cliVersion}); nothing extracted`);
    return { events: [], usage: [], notes };
  }

  // Attach each token delta to the next action event in the session (or keep it in totals only).
  events.sort((a, b) => a.src.line - b.src.line);
  let ei = 0;
  for (const d of deltas) {
    while (ei < events.length && events[ei]!.src.line < d.line) ei++;
    const target = events[ei];
    if (!target) break;
    const t = target.tokens ?? emptyTokens();
    addTokens(t, d.tokens);
    target.tokens = t;
    target.model = d.model;
  }

  const usage: UsageRecord[] = deltas.map((d) => ({
    tsMs: d.tsMs,
    cwd: d.cwd,
    agent: "codex",
    model: d.model,
    tokens: d.tokens,
  }));
  return { events, usage, notes };
}
