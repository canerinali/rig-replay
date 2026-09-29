import type { Lane, RigEvent } from "../schema.js";

export const LOOP_SPAN_MS = 30 * 60_000;

/** In-repo files of an event (outside-repo files keep an absolute path and are excluded). */
export function inRepoFiles(e: RigEvent): string[] {
  return e.files.filter((f) => !f.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(f));
}

export function laneMap(lanes: Lane[]): Map<string, Lane> {
  return new Map(lanes.map((l) => [l.id, l]));
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Given occurrences sorted by time, return the "episodes": groups of occurrences that belong to
 * some window of `spanMs` containing at least `threshold` occurrences. Consecutive marked
 * occurrences at most `spanMs` apart form one episode.
 */
export function denseEpisodes<T extends { tsMs: number }>(items: T[], threshold: number, spanMs: number): T[][] {
  const marked = new Array<boolean>(items.length).fill(false);
  let j = 0;
  for (let i = 0; i < items.length; i++) {
    if (j < i) j = i;
    while (j + 1 < items.length && items[j + 1]!.tsMs - items[i]!.tsMs <= spanMs) j++;
    if (j - i + 1 >= threshold) for (let k = i; k <= j; k++) marked[k] = true;
  }
  const episodes: T[][] = [];
  let cur: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!marked[i]) continue;
    const prev = cur[cur.length - 1];
    if (prev && items[i]!.tsMs - prev.tsMs > spanMs) {
      episodes.push(cur);
      cur = [];
    }
    cur.push(items[i]!);
  }
  if (cur.length) episodes.push(cur);
  return episodes;
}
