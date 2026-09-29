import type { ReportData, RigEvent } from "./schema.js";

export const SECRET_MASK = "[redacted secret]";

/** Token shapes masked everywhere. Every pattern is linear (no nested or adjacent overlapping quantifiers). */
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]{0,40}PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]+/g,
  /\bxox[abprs]-[A-Za-z0-9-]+/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
];

/** Names whose `NAME=value` assignment gets its value masked (the name is kept). */
const SECRET_NAME = /token|secret|passw(?:or)?d|api[_-]?key|private[_-]?key|credential/i;

/**
 * Mask well-known credential shapes: provider API keys and tokens, AWS access key ids, PEM private keys,
 * `Authorization: Bearer|Basic <value>`, `Bearer <token>` and `NAME=value` where NAME looks like a
 * secret (TOKEN, SECRET, PASSWORD, API_KEY, ...). Applied to all prompt and command text at parse time,
 * with or without --redact.
 */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of TOKEN_PATTERNS) out = out.replace(re, SECRET_MASK);
  out = out.replace(/(authorization:\s*(?:bearer|basic)\s+)[^\s"']+/gi, `$1${SECRET_MASK}`);
  out = out.replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, (m, pre: string) =>
    m.includes(SECRET_MASK) ? m : `${pre}${SECRET_MASK}`,
  );
  out = out.replace(/(^|[^A-Za-z0-9_-])([A-Za-z0-9_-]+)=("[^"]*"|'[^']*'|[^\s"']+)/g, (m, pre: string, name: string, value: string) =>
    SECRET_NAME.test(name) && !value.startsWith("[redacted") ? `${pre}${name}=${SECRET_MASK}` : m,
  );
  return out;
}

export function placeholder(text: string): string {
  return `[redacted ${text.length} chars]`;
}

const FREE_TEXT_TOOLS = new Set(["Agent", "Task"]);

/** Replace prompt and command text (and summaries derived from them) with length placeholders. Paths are kept. */
export function redactEvents(events: RigEvent[]): RigEvent[] {
  return events.map((e) => {
    const out: RigEvent = { ...e };
    if (e.kind === "prompt" || e.kind === "shell" || (e.tool && FREE_TEXT_TOOLS.has(e.tool))) {
      out.summary = placeholder(e.summary);
    }
    if (e.command !== undefined) out.command = placeholder(e.command);
    return out;
  });
}

/** Redact a finished report in place-safe fashion (returns a new object). */
export function redactReport(data: ReportData): ReportData {
  const prefix = "Repeated command: ";
  return {
    ...data,
    options: { ...data.options, redacted: true },
    events: redactEvents(data.events),
    warnings: data.warnings.map((w) =>
      w.kind === "loop-shell" && w.title.startsWith(prefix)
        ? { ...w, title: prefix + placeholder(w.title.slice(prefix.length)) }
        : w,
    ),
  };
}
