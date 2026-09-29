# Security review: rig-replay 0.1.0

Date: 2026-09-29. Scope: everything tracked in the repository at commit `55c0d8e` (src, tests, fixtures,
examples, package metadata) plus the built `dist/` and the full git history.

Threat model: rig-replay is a local CLI. Its inputs (Claude Code / Codex JSONL logs, and the repo it is
pointed at) are partly attacker-influenced: a malicious repository or web page can make an agent print or
run arbitrary strings, which then appear in the logs. The output (an HTML report) is meant to be opened in a
browser and is often shared with other people.

## Summary

| ID | Severity | Title | Status |
| -- | -------- | ----- | ------ |
| M1 | Medium | Report is written through symlinks; default output path lives in the (possibly untrusted) cwd | Fixed (a817212) |
| M2 | Medium | Secrets in shell commands and prompts are embedded in the report by default | Fixed (a817212) |
| L1 | Low | Quadratic regex in the `apply_patch` header parser | Fixed (a817212) |
| L2 | Low | `--redact` keeps identifying metadata (absolute cwd, home dir, out-of-repo paths) | Open |
| L3 | Low | No Content-Security-Policy in the report (defense in depth) | Open |
| L4 | Low | Log-derived strings are printed to the terminal unsanitized | Fixed (a817212) |
| L5 | Low | Crafted `.git` metadata in the target dir can widen the report scope | Open |
| L6 | Low | JSONL lines are read with no size cap | Open |
| I1-I9 | Info | Audit, secrets, network, XSS verification, licenses and minor notes | - |

No High findings. Both Medium findings (M1, M2) and L1, L4 are fixed; L2, L3, L5, L6 remain open.

## Medium

### M1. Report is written through symlinks; default output path lives in the cwd

**Status: Fixed in `a817212`.** `src/output.ts` (`writeReportFile`) `lstat`s the output path and refuses symlinks and non-regular files, then opens it with `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW` (an `ELOOP` from the race window is also refused) and mode `0600` (an existing file is `chmod`ed to `0600`). `test/cli.e2e.test.ts` plants a symlink at the default output path and asserts exit code 1, the refusal message, and that the target is untouched; another test asserts mode `0600`.

`src/cli.ts:55-56` writes the report with `mkdir(..., { recursive: true })` and a plain
`writeFile(opts.out, body)`, which follows a symlink at the target path and truncates whatever it points
to. The default output path is `./rig-replay-report.html` in the current directory
(`src/options.ts:103`), and the natural way to use the tool is to run it inside the repo being examined.

Verified: a directory containing `.git/` and a symlink `rig-replay-report.html -> <victim file>`; running
`rig-replay` there with default options replaced the victim file's contents with the HTML report. A
repository (or archive) that ships such a symlink can therefore make a user clobber any file they can
write (`~/.bashrc`, `~/.ssh/authorized_keys`, project files). The content written is HTML, so this is data
destruction rather than code execution, but it is silent.

Fix (`src/cli.ts:55-56`):
- Open the output with no-follow semantics and a private mode, e.g.
  ```ts
  import { constants as C } from "node:fs";
  const flags = C.O_WRONLY | C.O_CREAT | C.O_TRUNC | (C.O_NOFOLLOW ?? 0);
  await writeFile(opts.out, body, { flag: flags, mode: 0o600 });
  ```
  and, because `O_NOFOLLOW` is not available on Windows, also `lstat(opts.out)` first and refuse with
  `rig-replay: refusing to write through symlink <path>` when `isSymbolicLink()` is true.
- Optionally write to a temp file in the same directory and `rename()` it into place (rename replaces the
  link itself, not its target).
- Add an e2e test in `test/cli.e2e.test.ts` that plants a symlink at the default output path and asserts
  the target is untouched and the exit code is 1.

### M2. Secrets in shell commands and prompts are embedded by default

**Status: Fixed in `a817212`.** `scrubSecrets()` in `src/redact.ts` masks the listed token shapes (sk-/sk-ant-, gh[pousr]_, github_pat_, xox?-, AKIA, AIza, PEM private keys including the body, `Authorization: Bearer|Basic`, bare `Bearer <token>`, and secret-named `NAME=value` assignments with the name kept). It is applied at parse time, always, to Claude/Codex prompts (capped at 4000 chars before scrubbing), commands (after the 500-char cap) and Agent/Task spawn descriptions. All patterns are linear (the assignment matcher checks the name in a callback instead of using nested quantifiers); `test/redact.test.ts` covers each shape, false positives and adversarial inputs. `renderHtml` no longer embeds `command` (search uses `summary`), the report is written `0600`, and the CLI prints `note: report contains prompt and command text ...; use --redact before sharing` when `--redact` is off. README Privacy section updated.

Without `--redact`, every event keeps up to 200 characters of prompt text and every shell event keeps the
command twice: `summary` (200 chars) and `command` (500 chars):
- `src/parsers/claude.ts:133`, `:154` (prompts), `:250-251` (Bash command)
- `src/parsers/codex.ts:165`, `:181`, `:267`, `:273` (commands), `:218`, `:248` (prompts)

Commands such as `curl -H "Authorization: Bearer ..."`, `export OPENAI_API_KEY=...`,
`mysql -p...`, `gh auth login --with-token <<< ghp_...` and pasted keys in prompts are common in agent
logs. Verified with a synthetic log: a `Bearer sk-live-...` token and a `ghp_...` token both appear
verbatim in the embedded JSON of the default report (and are absent with `--redact`). The report is
written world-readable (0644, see M1) into the repo root, where `rig-replay-report.html` is not covered by
the user's `.gitignore`, so an accidental commit or share of the report leaks those credentials. The
README documents the risk ("treat it like the logs"), which is why this is Medium rather than High.

Tool outputs are not embedded (only exit status), and Edit/Write content is reduced to line counts and a
SHA-1, which is good.

Fix:
1. Add `scrubSecrets(s: string): string` to `src/redact.ts` that masks well-known token shapes and
   assignments, at minimum: `sk-[A-Za-z0-9_-]{16,}`, `sk-ant-[A-Za-z0-9_-]+`, `gh[pousr]_[A-Za-z0-9]{20,}`,
   `github_pat_[A-Za-z0-9_]+`, `xox[abprs]-[A-Za-z0-9-]+`, `AKIA[0-9A-Z]{16}`, `AIza[0-9A-Za-z_-]{35}`,
   `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `(?i)(authorization:\s*(bearer|basic)\s+)\S+`, and
   `(?i)\b([A-Z0-9_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)[A-Z0-9_]*)=\S+` (keep the name, mask the value).
   Apply it at capture time, always (not only under `--redact`), in the parser lines listed above, before
   `oneLine`/`slice`. Keep every regex linear (no nested quantifiers) and apply it after the 500-char cap.
2. Do not embed `command` in the HTML at all: the client only uses it for search
   (`src/report/assets.ts`, `visible()`), and `summary` already carries the first 200 chars. In
   `src/report/html.ts:52`, serialize `{ ...data, events: data.events.map(({ command, ...e }) => e) }`
   (keep `command` in `--json` if wanted, it is needed only by `findLoops`, which runs before rendering).
3. Write the report with mode `0o600` (see M1).
4. When `--redact` is not set, print one stderr line after the summary, e.g.
   `note: report contains prompt and command text; use --redact before sharing`.

## Low

### L1. Quadratic regex in the `apply_patch` header parser

**Status: Fixed in `a817212`.** Header regex is now `/^\*\*\* (Add File|Update File|Delete File|Move to): (.*)$/` with `trim()` and empty paths skipped; the `gitdir:` parser in `src/repo.ts` got the same treatment. `test/applyPatch.test.ts` parses a header with 200,000 spaces in well under 200 ms.

`src/parsers/applyPatch.ts:8`: `/^\*\*\* (Add File|Update File|Delete File|Move to): (.+?)\s*$/`. The lazy
`(.+?)` followed by `\s*$` backtracks over a long run of whitespace for every extra character, giving
O(n^2) per line. Measured on the built code: a header line with 40,000 trailing spaces plus one character
takes 0.9 s, 160,000 takes 15 s. Patch text comes from the model (and can be steered by prompt injection)
and from the log file, so a crafted log can hang the CLI. Impact is availability of a local tool only.

Fix: use `/^\*\*\* (Add File|Update File|Delete File|Move to): (.*)$/` and `m[2].trim()` (skip the entry
when the result is empty). The same `(.+?)\s*$` shape in `src/repo.ts:39` (`gitdir:` line of a local
`.git` file) should get the same treatment for consistency.

### L2. `--redact` keeps identifying metadata

`redactReport` (`src/redact.ts`) replaces prompt, command and Task/Agent description text only. A
"shareable" report still contains: the absolute `cwd` of every event, `repo.root` and worktree paths,
`sources.claudeDir` / `sources.codexDir` (`src/index.ts:81`, e.g. `/home/<user>/.claude/projects`, which
reveals the username), absolute paths of files outside the repo that agents read or edited (for example
`/home/<user>/.aws/credentials`, shown as-is in `merge.ts`), full session ids and the evidence file labels.
This is documented ("paths are kept") and not a secret leak by itself, but it is more than users may
expect from a "shareable" report.

Fix: under `--redact`, set `sources` to `null`s, drop `cwd` from events (it is not used by the client),
replace out-of-repo absolute paths with `[outside repo]` (or their basename), and consider replacing
`repo.root` with its basename.

### L3. No Content-Security-Policy in the report

The report is XSS-free as written (see I4), but it has no CSP to contain a future regression, and the
"makes no network requests" promise is not enforced by the browser. Fix in `src/report/html.ts:14`: add

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-<b64>'; style-src 'sha256-<b64>'; img-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
```

computing both hashes at render time with `node:crypto` over `CLIENT_JS` and `CSS` exactly as emitted. The
`<script type="application/json">` data block is not executed and needs no hash. Move the inline
`style="margin-top:10px"` at `src/report/html.ts:40` into a CSS class (style attributes are blocked
without `'unsafe-inline'`; styles set from JS through `element.style` are not affected). The meta tag must
come before the `<style>` and `<script>` elements.

### L4. Log-derived strings printed to the terminal unsanitized

**Status: Fixed in `a817212`.** `sanitizeTerminal()` in `src/summary.ts` replaces C0/C1 control characters with `?` on every summary line and on every CLI error message (`src/cli.ts`). Covered by `test/summary.test.ts`.

`src/summary.ts:41` prints up to five parser notes to stderr. Notes include log file labels (directory
and file names under the log dirs) and, for unrecognized Codex rollouts, the `cli_version` string taken
from the log (`src/parsers/codex.ts:139`, used in the note at `:332`). A crafted log can put ANSI/OSC
escape sequences there (terminal title changes, hyperlinks, screen clearing). Fix: in `summaryLines`
replace C0/C1 control characters (`/[\u0000-\u001f\u007f-\u009f]/g`) with `?` for every interpolated
string (notes, repo root, output path).

### L5. Crafted `.git` metadata in the target dir can widen the report scope

`src/repo.ts` trusts the target's `.git` file (`gitdir:`), `commondir`, and
`.git/worktrees/*/gitdir`. If a directory is delivered with its own `.git` (archive, not `git clone`), a
worktree entry pointing at e.g. `/home/.git` makes `/home` a "worktree root": `findClaudeFiles` then
matches every `-home-...` project and `matchRoot` accepts every cwd under `/home`, so the report pulls in
the user's sessions from unrelated projects. The risk is a user sharing a report they believe covers
only one repo. Fix in `listWorktrees`/`resolveWorktree`: ignore worktree roots that are equal to or an
ancestor of `mainRoot` or of the user's home directory, and require that `<root>/.git` is a file whose
`gitdir:` resolves back into `<mainRoot>/.git/worktrees/<name>`.

### L6. JSONL lines are read with no size cap

`src/jsonl.ts:21` uses `readline` with no maximum line length, then `JSON.parse` on the whole line. A
multi-hundred-MB line (possible with large tool results in Claude logs) is buffered in memory; beyond
V8's string limit it throws, which `parseAll` turns into a per-file note, so it degrades rather than
crashes. Consider skipping lines above a limit (e.g. 64 MB) with a parser note.

## Info

- **I1. Dependency audit.** `npm audit`: 0 vulnerabilities (prod and dev). `npm audit --omit=dev`: 0
  vulnerabilities. Production dependencies are only `commander@14.0.3` and `zod@4.6.5`, with no
  transitive dependencies.
- **I2. Secrets and personal data in the repo.** `git grep` over tracked files and `git log -p --all` over
  the full history found no API keys, tokens, private keys, passwords, `.env`/`.pem`/credential files,
  real home paths (`/home/...`, `/Users/...`) or personal/work e-mail addresses. The only hits are the
  string `const SECRET = process.env.SECRET` inside a synthetic demo Edit and `process.env` in source.
  Fixtures, examples and snapshots use synthetic `/work/acme-api`, `/work/other*` paths and made-up ids.
  All 8 commits are authored and committed by `canerinali <32527189+canerinali@users.noreply.github.com>`
  with no co-author trailers. `PLAN.md` exists locally but is excluded via `.git/info/exclude` and was
  never committed.
- **I3. No network, telemetry or subprocesses.** `src/` and `dist/` import only `node:fs`,
  `node:fs/promises`, `node:path`, `node:os`, `node:crypto`, `node:readline`, `commander` and `zod`. No
  `http`, `https`, `net`, `dns`, `tls`, `child_process`, `fetch`, `eval` or `new Function`. The only URL
  in the report is the SVG namespace string `http://www.w3.org/2000/svg` (an identifier, never fetched);
  the CSS uses system fonts only. (`commander` can spawn executable subcommands, but none are defined.)
- **I4. HTML report XSS: verified safe.** `src/report/html.ts` interpolates only the escaped title
  (`escapeHtml`, covers `& < > " '`), the constant `CSS` and `CLIENT_JS`, and the data block via
  `safeJsonForScript`, which escapes `<`, `>`, `&`, U+2028 and U+2029 as `\uXXXX` (so `</script>` and
  `<!--` cannot appear). The client builds the DOM exclusively with `textContent`, `createTextNode`,
  `setAttribute` with hard-coded attribute names, and `className`; there is no `innerHTML`,
  `insertAdjacentHTML` or `document.write`. The only `href` is `#ev-<id>`. CSS variable names built from
  data (`var(--<agent>)`, `var(--k-<kind>)`) use parser-fixed enums. Tested with a synthetic log whose
  prompt, command, file path, tool name and model contained `</script><script>alert(1)</script>`,
  `<!--`, `<img onerror>`, quotes and U+2028/U+2029: the report has exactly the two expected `<script>`
  elements, the data block contains no raw `<`, `>`, U+2028 or U+2029, and it round-trips through
  `JSON.parse`.
- **I5. Licenses.** Production dependencies: MIT only (commander, zod), compatible with the project's
  MIT license. Dev-only dependencies (not shipped; `files` is `dist`, `README.md`, `LICENSE`): 33 MIT,
  3 Apache-2.0 (typescript, expect-type, detect-libc), 2 MPL-2.0 (lightningcss via vitest), 1 BSD-3-Clause,
  1 ISC. None affect the published package.
- **I6. Symlinked log files are skipped.** Discovery uses `Dirent.isFile()`, which is false for symlinks,
  so symlinked `.jsonl` files inside the log dirs are ignored (no following of links out of the log tree).
  `--claude-dir`/`--codex-dir`/`--prices` are user-supplied and read as given, which is expected.
- **I7. `--prices`** is parsed with `JSON.parse` and validated with a zod schema; errors are reported
  without echoing file content.
- **I8. Malformed URL hash.** `src/report/assets.ts:370` calls `decodeURIComponent(location.hash...)`,
  which throws on a malformed `#ev-%E0`. It runs after rendering, so the only effect is a console error;
  wrap it in `try/catch` if desired.
- **I9. `prepare` runs `tsc`** on install from git. This is standard; npm installs of the published
  tarball do not run it.

## Open High/Medium

None. M1 and M2 are fixed in `a817212`. No High findings.

## Re-verification (2026-09-29)

Independent re-check of `a817212` by the reviewer: built `dist/`, reran the original proof-of-concept inputs, changed no code.

- **M1: verified fixed.** A symlink planted at the default `./rig-replay-report.html`, at `--json --out out.json`, and a dangling symlink at `--out` are all refused with exit 1 and `refusing to write through symlink`. The link targets were not modified and no dangling target was created. New and pre-existing (0644) report files end up mode 0600.
- **M2: verified fixed.** The synthetic log with `Authorization: Bearer sk-live-...`, `ghp_...` and `sk-ant-...` in the prompt and command, run without `--redact`, produces HTML and `--json` output that contain none of the three tokens. The HTML data block has no `command` field, and stderr prints the `--redact` note. The XSS payloads in the same log still render inert (2 `<script>` elements, no raw `<`, `>`, U+2028 or U+2029 in the data block). `scrubSecrets` stayed under 20 ms on 100k-character adversarial inputs.
- **L1: verified fixed.** A header with 40k/160k/1M trailing spaces now parses in 0/1/2 ms (was 0.9 s / 15 s for 40k/160k).
- **L4: verified fixed.** A Codex `cli_version` containing ESC/OSC/BEL/CSI (C1 0x9b) and a newline reaches the stderr parser note as `?` characters. Stderr contains 0 control characters apart from the line separators.
- `npm test`: 18 files, 114 tests passed. `tsc --noEmit` clean. `npm audit` and `npm audit --omit=dev`: 0 vulnerabilities.

Residual (Low, best-effort scrubbing, not blocking): `scrubSecrets` does not mask credentials that do not use a known token shape or a `NAME=value` form:
- URL userinfo (`postgres://user:pass@host`)
- `curl -u user:pass`
- `mysql -pPASS`
- `--password VALUE` or `docker login -p VALUE` (space-separated)
- `aws configure set aws_secret_access_key VALUE`
- Stripe `sk_live_`/`rk_live_` keys

Suggested additions to `TOKEN_PATTERNS`/`scrubSecrets` in `src/redact.ts`: `://[^/\s:@]+:[^@\s/]+@` (mask the password part), `(--?(?:password|passwd|token|secret|api-?key)[= ]|-p)\S+` for flags, and `\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}`. `--redact` remains the reliable control for shared reports. Open High/Medium after re-verification: none.
