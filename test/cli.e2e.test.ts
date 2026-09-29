import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import type { ReportData } from "../src/schema.js";

const run = promisify(execFile);
const ROOT = path.join(import.meta.dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const DEMO = path.join(ROOT, "examples", "demo-logs");

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeAll(async () => {
  await run("npm", ["run", "build"], { cwd: ROOT });
  tmp = await mkdtemp(path.join(tmpdir(), "rig-e2e-"));
  const home = path.join(tmp, "home");
  await mkdir(home);
  // HOME points at an empty temp dir: the CLI must never read the real ~/.claude or ~/.codex.
  env = { PATH: process.env.PATH, HOME: home, USERPROFILE: home };
});

const demoArgs = [
  "--repo",
  "/work/acme-api",
  "--since",
  "all",
  "--now",
  "2026-09-21T00:00:00Z",
  "--claude-dir",
  path.join(DEMO, "claude", "projects"),
  "--codex-dir",
  path.join(DEMO, "codex"),
];

describe("rig-replay CLI (built)", () => {
  it("writes an HTML report for the demo logs", async () => {
    const out = path.join(tmp, "r.html");
    const { stdout, stderr } = await run("node", [CLI, ...demoArgs, "--out", out], { env, cwd: tmp });
    expect(stdout).toBe("");
    expect(existsSync(out)).toBe(true);
    const html = await readFile(out, "utf8");
    expect(html).toContain('id="rig-data"');
    const m = /<script type="application\/json" id="rig-data">([\s\S]*?)<\/script>/.exec(html)!;
    const data = JSON.parse(m[1]!) as ReportData;
    expect(new Set(data.events.map((e) => e.agent))).toEqual(new Set(["claude", "codex"]));
    expect(data.warnings).toHaveLength(2);
    expect(stderr).toContain("1 possible conflict, 1 loop");
    expect(stderr).toContain("estimated cost: $");
    expect(stderr).toContain("claude: 2 sessions (1 subagent)");
    expect(stderr).not.toMatch(/\bconflicts? on\b/i);
  });

  it("writes the report with mode 0600 and warns that text is not redacted", async () => {
    const out = path.join(tmp, "private.html");
    const { stderr } = await run("node", [CLI, ...demoArgs, "--out", out], { env, cwd: tmp });
    expect((await stat(out)).mode & 0o777).toBe(0o600);
    expect(stderr).toContain("use --redact before sharing");
    const red = await run("node", [CLI, ...demoArgs, "--out", out, "--redact"], { env, cwd: tmp });
    expect(red.stderr).not.toContain("use --redact before sharing");
  });

  it("refuses to write through a symlink at the default output path", async () => {
    const dir = path.join(tmp, "planted");
    await mkdir(path.join(dir, ".git"), { recursive: true });
    const victim = path.join(tmp, "victim.txt");
    await writeFile(victim, "precious\n");
    await symlink(victim, path.join(dir, "rig-replay-report.html"));
    const err = await run(
      "node",
      [CLI, "--claude-dir", path.join(DEMO, "claude", "projects"), "--codex-dir", path.join(DEMO, "codex")],
      { env, cwd: dir },
    ).catch((e: { code: number; stderr: string }) => e);
    expect(err).toMatchObject({ code: 1 });
    expect((err as { stderr: string }).stderr).toContain("refusing to write through symlink");
    expect(await readFile(victim, "utf8")).toBe("precious\n");
  });

  it("prints valid JSON to stdout with --json", async () => {
    const { stdout, stderr } = await run("node", [CLI, ...demoArgs, "--json"], { env, cwd: tmp });
    const data = JSON.parse(stdout) as ReportData;
    expect(data.version).toBe(1);
    expect(data.generatedAt).toBe("2026-09-21T00:00:00.000Z");
    expect(data.events.every((e) => !e.cwd.startsWith("/work/other-repo"))).toBe(true);
    expect(stderr).toContain("rig-replay: repo /work/acme-api (all time)");
  });

  it("exits 0 with a clear message when no sessions are found", async () => {
    const empty = path.join(tmp, "empty");
    await mkdir(path.join(empty, "claude"), { recursive: true });
    await mkdir(path.join(empty, "codex"), { recursive: true });
    const out = path.join(tmp, "empty.html");
    const { stderr } = await run(
      "node",
      [CLI, "--repo", "/work/acme-api", "--claude-dir", path.join(empty, "claude"), "--codex-dir", path.join(empty, "codex"), "--out", out],
      { env, cwd: tmp },
    );
    expect(stderr).toContain("no sessions found for this repo");
    expect(stderr).toContain(path.join(empty, "claude"));
    expect(existsSync(out)).toBe(true);
  });

  it("uses $HOME defaults and finds nothing there", async () => {
    const { stdout, stderr } = await run("node", [CLI, "--repo", "/work/acme-api", "--json"], { env, cwd: tmp });
    expect(JSON.parse(stdout).events).toEqual([]);
    expect(stderr).toContain(path.join(env.HOME!, ".claude", "projects"));
  });

  it("exits 1 on bad options and unwritable output", async () => {
    await expect(run("node", [CLI, "--window", "soon"], { env, cwd: tmp })).rejects.toMatchObject({ code: 1 });
    await expect(run("node", [CLI, "--loop-threshold", "1"], { env, cwd: tmp })).rejects.toMatchObject({ code: 1 });
    const blocker = path.join(tmp, "r.html"); // a file, so it cannot be used as a directory
    await expect(
      run("node", [CLI, ...demoArgs, "--out", path.join(blocker, "x.html")], { env, cwd: tmp }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("lists every option in --help", async () => {
    const { stdout } = await run("node", [CLI, "--help"], { env, cwd: tmp });
    for (const o of ["--repo", "--since", "--out", "--json", "--window", "--loop-threshold", "--claude-dir", "--codex-dir", "--no-claude", "--no-codex", "--prices", "--redact", "--version"]) {
      expect(stdout).toContain(o);
    }
  });
});
