# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories:

1. Go to https://github.com/canerinali/rig-replay/security/advisories/new
   (repository "Security" tab, then "Report a vulnerability").
2. Describe the issue, the affected version, and steps or a sample log file that reproduces it.
   Please use synthetic log content; do not attach real session logs that contain your prompts,
   commands or credentials.

Do not open a public issue or pull request for a security problem before it has been fixed.

You can expect an acknowledgement within 7 days. Once the issue is confirmed, a fix is released as a
0.1.x patch version and the advisory is published with credit to the reporter (unless you prefer to
stay anonymous).

## Scope

rig-replay is a local CLI: it reads Claude Code and Codex JSONL logs from disk and writes one
self-contained HTML (or JSON) report. It makes no network requests and runs no child processes.
Issues of particular interest:

- Script injection in the generated HTML report from log content (prompts, commands, file paths,
  model or tool names).
- The CLI reading or writing files outside the paths the user asked for.
- Secrets or private data ending up in a report despite `--redact`.
- Log content that makes the CLI hang or exhaust memory.

Note that a report generated without `--redact` intentionally contains prompt and command text from
your logs. Treat it like the logs themselves and review it before sharing.
