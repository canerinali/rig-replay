import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { SubagentRef } from "./schema.js";

export interface LogFile {
  agent: "claude" | "codex";
  file: string;
  /** Short label for evidence pointers, relative to the scanned root. */
  label: string;
  subagent?: SubagentRef;
}

const DAY_MS = 86_400_000;

/** Claude's lossy project-dir encoding: every non-alphanumeric character becomes "-". */
export function encodeClaudeDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

async function listDir(dir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function modifiedSince(file: string, sinceMs: number | null): Promise<boolean> {
  if (sinceMs === null) return true;
  try {
    return (await stat(file)).mtimeMs >= sinceMs;
  } catch {
    return false;
  }
}

/** Claude long project dir names are truncated; compare on the common prefix length. */
function dirMatches(dirName: string, encodedRoots: string[]): boolean {
  return encodedRoots.some((enc) => {
    if (dirName === enc || dirName.startsWith(`${enc}-`)) return true;
    return dirName.length >= 200 && enc.length >= 200 && dirName.slice(0, 200) === enc.slice(0, 200);
  });
}

/**
 * Find Claude session and subagent files for any of `repoRoots` (main root + worktrees).
 * The directory-name encoding is only a pre-filter; the per-line `cwd` decides later.
 */
export async function findClaudeFiles(root: string, repoRoots: string[], sinceMs: number | null): Promise<LogFile[]> {
  const encoded = repoRoots.map(encodeClaudeDir);
  const out: LogFile[] = [];
  const projects = (await listDir(root)).filter((d) => d.isDirectory() && dirMatches(d.name, encoded));
  for (const proj of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    const projDir = path.join(root, proj.name);
    const entries = await listDir(projDir);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(projDir, e.name);
      if (e.isFile() && e.name.endsWith(".jsonl")) {
        if (await modifiedSince(full, sinceMs)) {
          out.push({ agent: "claude", file: full, label: path.join("claude", proj.name, e.name) });
        }
        continue;
      }
      if (!e.isDirectory()) continue;
      const subDir = path.join(full, "subagents");
      for (const s of (await listDir(subDir)).sort((a, b) => a.name.localeCompare(b.name))) {
        const m = /^agent-(.+)\.jsonl$/.exec(s.name);
        if (!s.isFile() || !m) continue;
        const subFile = path.join(subDir, s.name);
        if (!(await modifiedSince(subFile, sinceMs))) continue;
        const agentId = m[1]!;
        let type: string | undefined;
        try {
          const meta = JSON.parse(await readFile(path.join(subDir, `agent-${agentId}.meta.json`), "utf8")) as {
            agentType?: unknown;
          };
          if (typeof meta.agentType === "string") type = meta.agentType;
        } catch {
          // missing or unreadable meta: type stays undefined
        }
        out.push({
          agent: "claude",
          file: subFile,
          label: path.join("claude", proj.name, e.name, "subagents", s.name),
          subagent: type ? { id: agentId, type } : { id: agentId },
        });
      }
    }
  }
  return out;
}

/**
 * Find Codex rollout files under `<codexHome>/sessions/YYYY/MM/DD/`. Date folders older than
 * since minus one day are skipped without being listed (rollouts can span midnight / time zones).
 */
export async function findCodexFiles(codexHome: string, sinceMs: number | null): Promise<LogFile[]> {
  const sessions = path.join(codexHome, "sessions");
  const minDay = sinceMs === null ? null : new Date(sinceMs - DAY_MS).toISOString().slice(0, 10);
  const out: LogFile[] = [];
  const num = (d: import("node:fs").Dirent) => d.isDirectory() && /^\d+$/.test(d.name);
  for (const y of (await listDir(sessions)).filter(num).sort((a, b) => a.name.localeCompare(b.name))) {
    const yDir = path.join(sessions, y.name);
    for (const m of (await listDir(yDir)).filter(num).sort((a, b) => a.name.localeCompare(b.name))) {
      const mDir = path.join(yDir, m.name);
      for (const d of (await listDir(mDir)).filter(num).sort((a, b) => a.name.localeCompare(b.name))) {
        const day = `${y.name}-${m.name.padStart(2, "0")}-${d.name.padStart(2, "0")}`;
        if (minDay !== null && day < minDay) continue;
        const dDir = path.join(mDir, d.name);
        for (const f of (await listDir(dDir)).sort((a, b) => a.name.localeCompare(b.name))) {
          if (!f.isFile() || !f.name.startsWith("rollout-") || !f.name.endsWith(".jsonl")) continue;
          const full = path.join(dDir, f.name);
          if (!(await modifiedSince(full, sinceMs))) continue;
          out.push({ agent: "codex", file: full, label: path.join("codex", "sessions", y.name, m.name, d.name, f.name) });
        }
      }
    }
  }
  return out;
}
