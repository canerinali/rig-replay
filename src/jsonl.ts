import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface JsonlLine {
  line: number;
  value: unknown;
}

export interface JsonlStats {
  /** Lines that were not empty but failed to parse as JSON. Positions only, never content. */
  badLines: number[];
  totalLines: number;
}

/**
 * Stream a JSONL file, yielding parsed values with 1-based line numbers.
 * Empty lines are skipped silently; malformed lines are recorded in `stats.badLines` and skipped.
 * Never throws on content; I/O errors (missing file) propagate.
 */
export async function* readJsonl(file: string, stats?: JsonlStats): AsyncGenerator<JsonlLine> {
  const rl = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  let n = 0;
  for await (const raw of rl) {
    n++;
    if (stats) stats.totalLines = n;
    const text = raw.trim();
    if (text === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      stats?.badLines.push(n);
      continue;
    }
    yield { line: n, value };
  }
}

export function newJsonlStats(): JsonlStats {
  return { badLines: [], totalLines: 0 };
}

/** Parser notes for bad lines: a count plus the first 5 positions. */
export function badLineNotes(file: string, stats: JsonlStats): string[] {
  if (stats.badLines.length === 0) return [];
  const first = stats.badLines.slice(0, 5).map((l) => `${file}:${l}`).join(", ");
  const more = stats.badLines.length > 5 ? ` (+${stats.badLines.length - 5} more)` : "";
  return [`${stats.badLines.length} bad line(s) skipped: ${first}${more}`];
}
