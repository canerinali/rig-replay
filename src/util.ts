import { createHash } from "node:crypto";

export function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

/** Collapse whitespace to one line and cap the length (ASCII "..." marks truncation). */
export function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
}

export function lineCount(s: string | undefined): number {
  if (!s) return 0;
  const body = s.endsWith("\n") ? s.slice(0, -1) : s;
  return body.split("\n").length;
}
