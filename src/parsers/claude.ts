import path from "node:path";
import { badLineNotes, newJsonlStats, readJsonl } from "../jsonl.js";
import {
  ClaudeLineSchema,
  type ParseResult,
  type RigEvent,
  type SubagentRef,
  type Tokens,
  type UsageRecord,
} from "../schema.js";
import { parseTs } from "../time.js";
import { scrubSecrets } from "../redact.js";
import { lineCount, oneLine, sha1 } from "../util.js";

/** Prompt text is capped before scrubbing so scrubbing stays cheap on huge pastes. */
const MAX_TEXT = 4000;
const promptText = (s: string) => oneLine(scrubSecrets(s.slice(0, MAX_TEXT)), 200);

export interface ClaudeParseOptions {
  /** Label used in evidence pointers (e.g. "claude/-work-acme-api/<sid>.jsonl"); defaults to the file path. */
  srcLabel?: string;
  /** Set for subagent files (from the sibling .meta.json). */
  subagent?: SubagentRef;
}

/** Line types that exist in Claude Code logs but carry nothing we render. Skipped without a note. */
const KNOWN_SKIPPED = new Set([
  "attachment",
  "system",
  "queue-operation",
  "file-history-snapshot",
  "custom-title",
  "agent-name",
  "mode",
  "last-prompt",
  "bridge-session",
  "atis-latch",
  "summary",
  "cost-state",
  "file-history-delta",
  "relocated",
  "permission-mode",
  "ai-title",
]);

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SPAWN_TOOLS = new Set(["Agent", "Task"]);

const SKIP_PROMPT_PREFIXES = ["<command-", "<local-command-", "<system-reminder>"];

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function claudeTokens(u: Record<string, unknown> | undefined): Tokens | undefined {
  if (!u) return undefined;
  const n = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return {
    input: n("input_tokens"),
    output: n("output_tokens"),
    cacheRead: n("cache_read_input_tokens"),
    cacheWrite: n("cache_creation_input_tokens"),
  };
}

function isSkippedPrompt(text: string): boolean {
  const t = text.trimStart();
  return SKIP_PROMPT_PREFIXES.some((p) => t.startsWith(p));
}

export async function parseClaudeFile(file: string, opts: ClaudeParseOptions = {}): Promise<ParseResult> {
  const label = opts.srcLabel ?? file;
  const stats = newJsonlStats();
  const events: RigEvent[] = [];
  const usage: UsageRecord[] = [];
  const notes: string[] = [];

  const pending = new Map<string, RigEvent>();
  const seenMsgIds = new Set<string>();
  /** message.id whose usage was recorded but not yet attached to an event (first line had no tool_use). */
  const unattached = new Map<string, { tokens: Tokens; model: string }>();
  /** Per lane+file: sha1(old \0 new) -> event id, for revert detection. */
  const editKeys = new Map<string, string>();

  let badShape = 0;
  let unknownTypes = 0;
  let noTimestamp = 0;
  let lastCwd = "";
  const fallbackSession = opts.subagent
    ? path.basename(path.dirname(path.dirname(file)))
    : path.basename(file, ".jsonl");

  for await (const { line, value } of readJsonl(file, stats)) {
    const typeProbe = (value as { type?: unknown } | null)?.type;
    if (typeof typeProbe === "string" && KNOWN_SKIPPED.has(typeProbe)) continue;
    if (typeProbe !== "user" && typeProbe !== "assistant") {
      unknownTypes++;
      continue;
    }
    const parsed = ClaudeLineSchema.safeParse(value);
    if (!parsed.success) {
      badShape++;
      continue;
    }
    const l = parsed.data;
    const tsMs = parseTs(l.timestamp);
    if (Number.isNaN(tsMs)) {
      noTimestamp++;
      continue;
    }
    if (l.cwd) lastCwd = l.cwd;
    const cwd = l.cwd ?? lastCwd;
    const sessionId = l.sessionId ?? fallbackSession;
    let subagent: SubagentRef | undefined = opts.subagent;
    if (!subagent && l.isSidechain && l.agentId) subagent = { id: l.agentId };
    const subId = subagent?.id;
    const laneKey = subId ?? "-";
    const idPrefix = `claude:${sessionId.slice(0, 8)}:${laneKey}`;

    const base = (blockIdx: number): Omit<RigEvent, "kind" | "summary" | "files"> => ({
      id: `${idPrefix}:${line}:${blockIdx}`,
      tsMs,
      agent: "claude",
      sessionId,
      ...(subagent ? { subagent } : {}),
      laneId: "",
      cwd,
      src: { file: label, line },
    });

    const msg = l.message;
    if (!msg) continue;

    if (l.type === "user") {
      const content = msg.content;
      if (typeof content === "string") {
        if (l.isMeta || isSkippedPrompt(content) || content.trim() === "") continue;
        events.push({ ...base(0), kind: "prompt", files: [], summary: promptText(content) });
        continue;
      }
      if (!Array.isArray(content)) continue;
      const texts: string[] = [];
      let hasToolResult = false;
      content.forEach((b) => {
        if (b.type === "tool_result" && b.tool_use_id) {
          hasToolResult = true;
          const ev = pending.get(b.tool_use_id);
          if (ev) {
            ev.ok = b.is_error !== true;
            pending.delete(b.tool_use_id);
          }
        } else if (b.type === "text" && typeof b.text === "string") {
          texts.push(b.text);
        }
      });
      if (!hasToolResult && !l.isMeta && texts.length > 0) {
        const text = texts.join(" ");
        if (!isSkippedPrompt(text) && text.trim() !== "") {
          events.push({ ...base(0), kind: "prompt", files: [], summary: promptText(text) });
        }
      }
      continue;
    }

    // assistant
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    const model = msg.model;
    const lineEvents: RigEvent[] = [];
    blocks.forEach((b, idx) => {
      if (b.type !== "tool_use" || !b.name) return;
      const input = (b.input ?? {}) as Record<string, unknown>;
      const name = b.name;
      const ev = toolEvent(name, input, base(idx), cwd, laneKey, editKeys);
      if (b.id) pending.set(b.id, ev);
      lineEvents.push(ev);
    });

    const msgId = msg.id;
    const tokens = claudeTokens(msg.usage as Record<string, unknown> | undefined);
    if (msgId && tokens && model && model !== "<synthetic>" && !seenMsgIds.has(msgId)) {
      seenMsgIds.add(msgId);
      usage.push({ tsMs, cwd, agent: "claude", model, tokens });
      if (lineEvents[0]) {
        lineEvents[0].tokens = tokens;
        lineEvents[0].model = model;
      } else {
        unattached.set(msgId, { tokens, model });
      }
    } else if (msgId && lineEvents[0] && unattached.has(msgId)) {
      const u = unattached.get(msgId)!;
      lineEvents[0].tokens = u.tokens;
      lineEvents[0].model = u.model;
      unattached.delete(msgId);
    }
    events.push(...lineEvents);
  }

  notes.push(...badLineNotes(label, stats));
  if (badShape) notes.push(`${label}: ${badShape} line(s) with unexpected shape skipped`);
  if (noTimestamp) notes.push(`${label}: ${noTimestamp} line(s) without a valid timestamp skipped`);
  if (unknownTypes) notes.push(`${label}: ${unknownTypes} line(s) of unknown type skipped`);
  return { events, usage, notes };
}

function toolEvent(
  name: string,
  input: Record<string, unknown>,
  base: Omit<RigEvent, "kind" | "summary" | "files">,
  cwd: string,
  laneKey: string,
  editKeys: Map<string, string>,
): RigEvent {
  const abs = (p: string) => (path.isAbsolute(p) ? path.normalize(p) : path.resolve(cwd || "/", p));

  if (EDIT_TOOLS.has(name)) {
    const target = str(input.file_path) ?? str(input.notebook_path);
    const files = target ? [abs(target)] : [];
    let hashSrc: string;
    let summary: string;
    let revertOf: string | undefined;
    if (name === "Edit") {
      const oldS = str(input.old_string) ?? "";
      const newS = str(input.new_string) ?? "";
      hashSrc = `${oldS}\u0000${newS}`;
      summary = `Edit: ${lineCount(oldS)} line(s) -> ${lineCount(newS)} line(s)${input.replace_all ? " (replace all)" : ""}`;
      const fileKey = `${laneKey}|${files[0] ?? ""}`;
      const reverseKey = `${fileKey}|${sha1(`${newS}\u0000${oldS}`)}`;
      revertOf = editKeys.get(reverseKey);
      const forwardKey = `${fileKey}|${sha1(hashSrc)}`;
      if (!editKeys.has(forwardKey)) editKeys.set(forwardKey, base.id);
    } else if (name === "Write") {
      const content = str(input.content) ?? "";
      hashSrc = content;
      summary = `Write: ${lineCount(content)} line(s)`;
    } else if (name === "MultiEdit") {
      const edits = Array.isArray(input.edits) ? input.edits : [];
      hashSrc = JSON.stringify(edits);
      summary = `MultiEdit: ${edits.length} edit(s)`;
    } else {
      hashSrc = JSON.stringify([input.cell_id ?? null, input.new_source ?? null, input.edit_mode ?? null]);
      summary = `NotebookEdit${typeof input.edit_mode === "string" ? `: ${input.edit_mode}` : ""}`;
    }
    return {
      ...base,
      kind: "file_edit",
      tool: name,
      files,
      editHash: sha1(`${name}\u0000${hashSrc}`),
      ...(revertOf ? { revertOf } : {}),
      summary,
    };
  }

  if (name === "Bash") {
    const command = scrubSecrets((str(input.command) ?? "").trim().slice(0, 500));
    return { ...base, kind: "shell", tool: name, files: [], command, summary: oneLine(command, 200) };
  }

  if (name === "Read") {
    const target = str(input.file_path);
    return { ...base, kind: "tool_call", tool: name, files: target ? [abs(target)] : [], summary: "Read" };
  }

  if (SPAWN_TOOLS.has(name)) {
    const type = str(input.subagent_type) ?? "agent";
    const desc = str(input.description) ?? "";
    return {
      ...base,
      kind: "tool_call",
      tool: name,
      files: [],
      summary: oneLine(scrubSecrets(`spawn ${type}${desc ? `: ${desc}` : ""}`.slice(0, MAX_TEXT)), 200),
    };
  }

  return { ...base, kind: "tool_call", tool: name, files: [], summary: oneLine(name, 200) };
}
