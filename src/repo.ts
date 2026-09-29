import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface RepoInfo {
  /** Directory that contains the `.git` entry (the worktree root for a linked worktree). */
  root: string;
  /** Main repository root (same as root for a normal checkout). */
  mainRoot: string;
  /** Linked worktree name (basename of its gitdir), when root is a linked worktree. */
  worktreeName?: string;
}

export interface WorktreeRoot {
  name: string;
  root: string;
}

/** The set of directories that count as "this repo": the main root plus all linked worktrees. */
export interface RepoTarget {
  mainRoot: string;
  worktrees: WorktreeRoot[];
  /** True when --repo did not exist on disk and was used literally. */
  literal: boolean;
}

const rootCache = new Map<string, RepoInfo | null>();

/** True when `child` equals `parent` or lies inside it (segment-wise, not raw string prefix). */
export function isInside(child: string, parent: string): boolean {
  const c = path.resolve(child);
  const p = path.resolve(parent);
  if (c === p) return true;
  const withSep = p.endsWith(path.sep) ? p : p + path.sep;
  return c.startsWith(withSep);
}

function readGitFile(gitFile: string): string | undefined {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(gitFile, "utf8"));
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Resolve a root whose `.git` may be a file (linked worktree) to its main repo root. */
export function resolveWorktree(root: string): RepoInfo {
  const gitPath = path.join(root, ".git");
  let st;
  try {
    st = statSync(gitPath);
  } catch {
    return { root, mainRoot: root };
  }
  if (st.isDirectory()) return { root, mainRoot: root };
  const gitdirRaw = readGitFile(gitPath);
  if (!gitdirRaw) return { root, mainRoot: root };
  const gitdir = path.resolve(root, gitdirRaw);
  let common = "../..";
  try {
    common = readFileSync(path.join(gitdir, "commondir"), "utf8").trim() || common;
  } catch {
    // default ../.. (gitdir is <main>/.git/worktrees/<name>)
  }
  const commonDir = path.resolve(gitdir, common);
  return { root, mainRoot: path.dirname(commonDir), worktreeName: path.basename(gitdir) };
}

/** Walk up from `dir` until a `.git` (dir or file) exists. Cached per directory. */
export function findRepoRoot(dir: string): RepoInfo | null {
  const start = path.resolve(dir);
  const visited: string[] = [];
  let cur = start;
  let result: RepoInfo | null = null;
  for (;;) {
    const cached = rootCache.get(cur);
    if (cached !== undefined) {
      result = cached;
      break;
    }
    visited.push(cur);
    if (existsSync(path.join(cur, ".git"))) {
      result = resolveWorktree(cur);
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  for (const v of visited) rootCache.set(v, result);
  return result;
}

export function clearRepoCache(): void {
  rootCache.clear();
}

/** Linked worktrees of a main repo, from `<main>/.git/worktrees/<name>/gitdir`. */
export function listWorktrees(mainRoot: string): WorktreeRoot[] {
  const wtDir = path.join(mainRoot, ".git", "worktrees");
  let names: string[];
  try {
    names = readdirSync(wtDir);
  } catch {
    return [];
  }
  const out: WorktreeRoot[] = [];
  for (const name of names.sort()) {
    try {
      const gitFile = readFileSync(path.join(wtDir, name, "gitdir"), "utf8").trim();
      if (!gitFile) continue;
      out.push({ name, root: path.dirname(path.resolve(wtDir, name, gitFile)) });
    } catch {
      // not a worktree entry
    }
  }
  return out;
}

/** Build the target set for --repo. A path that does not exist is used literally (demo/test roots). */
export function resolveTarget(repoArg: string): RepoTarget {
  const abs = path.resolve(repoArg);
  if (!existsSync(abs)) return { mainRoot: abs, worktrees: [], literal: true };
  const info = findRepoRoot(abs);
  if (!info) return { mainRoot: abs, worktrees: [], literal: false };
  return { mainRoot: info.mainRoot, worktrees: listWorktrees(info.mainRoot), literal: false };
}

export interface RootMatch {
  root: string;
  worktree?: string;
}

/**
 * Map a cwd to the repo root it belongs to: the longest known root (main or worktree) that
 * contains it. Works for directories that no longer exist (deleted worktrees, other machines).
 */
export function matchRoot(cwd: string, target: RepoTarget): RootMatch | null {
  if (!cwd) return null;
  let best: RootMatch | null = null;
  let bestLen = -1;
  const candidates: RootMatch[] = [
    { root: target.mainRoot },
    ...target.worktrees.map((w) => ({ root: w.root, worktree: w.name })),
  ];
  for (const c of candidates) {
    if (isInside(cwd, c.root) && c.root.length > bestLen) {
      best = c;
      bestLen = c.root.length;
    }
  }
  return best;
}

/** Make an absolute file path relative to `root`; returns null when it lies outside. */
export function toRel(file: string, root: string): string | null {
  if (!path.isAbsolute(file)) return file;
  if (!isInside(file, root)) return null;
  const rel = path.relative(root, file);
  return rel === "" ? "." : rel.split(path.sep).join("/");
}
