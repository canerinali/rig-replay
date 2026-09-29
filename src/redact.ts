import type { ReportData, RigEvent } from "./schema.js";

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
