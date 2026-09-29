const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parse "90s", "10m", "2h", "2d", "1w" (also "1.5h") into milliseconds. Throws on bad input. */
export function parseDuration(input: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smhdw])\s*$/i.exec(input);
  if (!m) {
    throw new Error(`invalid duration "${input}" (expected e.g. 90s, 10m, 2h, 2d, 1w)`);
  }
  const value = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  return Math.round(value * UNIT_MS[unit]!);
}

/**
 * Parse --since: a relative duration ("2d", "12h", "90m"), an absolute date or ISO timestamp
 * ("2026-09-01", "2026-09-01T10:00:00Z"), or "all" (returns null = no lower bound).
 * A bare date is interpreted as UTC midnight so results do not depend on the machine's time zone.
 */
export function parseSince(input: string, nowMs: number): number | null {
  const s = input.trim();
  if (s.toLowerCase() === "all") return null;
  if (/^\d+(?:\.\d+)?\s*[smhdw]$/i.test(s)) {
    return nowMs - parseDuration(s);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const ms = Date.parse(`${s}T00:00:00Z`);
    if (Number.isNaN(ms)) throw new Error(`invalid date "${input}"`);
    return ms;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) throw new Error(`invalid timestamp "${input}"`);
    return ms;
  }
  throw new Error(`invalid --since "${input}" (expected e.g. 2d, 12h, 90m, 2026-09-01 or all)`);
}

/** Parse an ISO timestamp from a log line; returns NaN when missing or invalid. */
export function parseTs(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  return Date.parse(value);
}

/** Human-friendly short duration: "45s", "6m", "2h 5m". */
export function formatDuration(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs < 60_000) return `${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${Math.round(abs / 60_000)}m`;
  const h = Math.floor(abs / 3_600_000);
  const m = Math.round((abs % 3_600_000) / 60_000);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** UTC date "YYYY-MM-DD" for an epoch ms value. */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
