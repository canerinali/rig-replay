import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  clearRepoCache,
  findRepoRoot,
  isInside,
  listWorktrees,
  matchRoot,
  resolveTarget,
  toRel,
} from "../src/repo.js";

let base: string;
let main: string;
let wt: string;

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), "rig-repo-")));
  main = path.join(base, "acme");
  wt = path.join(base, "acme-feature");
  // main repo with a real .git directory
  await mkdir(path.join(main, ".git", "worktrees", "acme-feature"), { recursive: true });
  await mkdir(path.join(main, "src", "deep"), { recursive: true });
  // linked worktree: .git file + commondir + gitdir back-pointer
  await mkdir(path.join(wt, "src"), { recursive: true });
  await writeFile(path.join(wt, ".git"), `gitdir: ${path.join(main, ".git", "worktrees", "acme-feature")}\n`);
  await writeFile(path.join(main, ".git", "worktrees", "acme-feature", "commondir"), "../..\n");
  await writeFile(path.join(main, ".git", "worktrees", "acme-feature", "gitdir"), `${path.join(wt, ".git")}\n`);
  clearRepoCache();
});

describe("repo", () => {
  it("isInside compares path segments, not raw prefixes", () => {
    expect(isInside("/work/acme-api/src", "/work/acme-api")).toBe(true);
    expect(isInside("/work/acme-api", "/work/acme-api")).toBe(true);
    expect(isInside("/work/acme-api-other/src", "/work/acme-api")).toBe(false);
    expect(isInside("/anything", "/")).toBe(true);
  });

  it("finds the repo root by walking up", () => {
    expect(findRepoRoot(path.join(main, "src", "deep"))).toEqual({ root: main, mainRoot: main });
    // cached result is identical
    expect(findRepoRoot(path.join(main, "src"))).toEqual({ root: main, mainRoot: main });
  });

  it("resolves a linked worktree to its main root", () => {
    expect(findRepoRoot(path.join(wt, "src"))).toEqual({ root: wt, mainRoot: main, worktreeName: "acme-feature" });
  });

  it("lists worktrees and builds the target from either checkout", () => {
    expect(listWorktrees(main)).toEqual([{ name: "acme-feature", root: wt }]);
    const fromWt = resolveTarget(wt);
    expect(fromWt).toEqual({ mainRoot: main, worktrees: [{ name: "acme-feature", root: wt }], literal: false });
    expect(resolveTarget(path.join(main, "src"))).toEqual(fromWt);
  });

  it("uses a non-existent --repo literally", () => {
    expect(resolveTarget("/work/acme-api")).toEqual({ mainRoot: "/work/acme-api", worktrees: [], literal: true });
  });

  it("matches cwd to the longest known root, even for deleted directories", () => {
    const t = resolveTarget(main);
    expect(matchRoot(path.join(main, "gone", "dir"), t)).toEqual({ root: main });
    expect(matchRoot(path.join(wt, "src"), t)).toEqual({ root: wt, worktree: "acme-feature" });
    expect(matchRoot("/elsewhere", t)).toBeNull();
    expect(matchRoot("", t)).toBeNull();
  });

  it("relativizes paths and flags outside ones", () => {
    expect(toRel("/work/acme-api/src/db.ts", "/work/acme-api")).toBe("src/db.ts");
    expect(toRel("/etc/hosts", "/work/acme-api")).toBeNull();
    expect(toRel("/work/acme-api-x/a.ts", "/work/acme-api")).toBeNull();
  });
});
