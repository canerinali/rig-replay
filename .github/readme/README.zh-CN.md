# rig-replay

**在一条时间线上查看所有编码代理在同一个仓库里做了什么，并在合并之前发现被两个代理同时改过的文件。**

[English](../../README.md) · [Türkçe](README.tr.md) · 简体中文 · [Español](README.es.md) · [Português (BR)](README.pt-BR.md)

> 这是翻译版本，以 [英文 README](../../README.md) 为准。

rig-replay 读取在同一个仓库中工作过的所有 Claude Code 和 Codex 会话的本地日志，生成一份离线 HTML 时间线。它会标出**可能的冲突**（两个代理或会话在短时间内编辑同一个文件）和**循环**（同一条命令或同一处编辑被反复执行），并将每一项链接到作为证据的日志行。

```
npx rig-replay --since 2d
```

无需安装（需要 Node.js 22 或更高版本）。在仓库内运行，它会写出 `./rig-replay-report.html`。

## 使用前 / 使用后

**使用前：** 两个终端里跑着两个代理，日志是两种格式，直到合并时才发现问题。

```
terminal 1  claude  "add pagination to the orders endpoint"   edits src/db.ts
terminal 2  codex   "fix the flaky db test"                   edits src/db.ts, runs npm test 5x
terminal 1  claude                                            edits src/db.ts again

~/.claude/projects/-work-acme-api/*.jsonl        one format, one file per session
~/.codex/sessions/2026/09/20/rollout-*.jsonl     another format, another place

...at merge time: "who changed the query in src/db.ts?"
```

**使用后：** 一条命令，一条时间线，警告已经在等你。

```
$ npx rig-replay --since 2d
rig-replay: repo /work/acme-api (since 2026-09-19)
  claude: 2 sessions (1 subagent), 21 events   codex: 2 sessions, 13 events
  1 possible conflict, 1 loop (edits observed in logs)
  estimated cost: $0.20 (price table: built-in, as of 2026-09-29)
  -> ./rig-replay-report.html
  note: report contains prompt and command text (known secret shapes are masked); use --redact before sharing

In the report:
  HIGH  Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df, interleaved within 9m
  HIGH  Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed
```

“使用后”的输出来自项目自带的合成演示日志（[examples/README.md](../../examples/README.md)）。

## 功能

- 为一个仓库中所有 Claude Code 和 Codex CLI 会话生成一条 HTML 时间线
- 子代理（subagent）和关联的 git worktree 各自拥有独立的泳道
- 当两条泳道在短时间内编辑同一文件时给出**可能的冲突**警告
- 同一命令或编辑重复出现时给出**循环**警告，失败和回退会提高严重程度
- 每条警告都链接到具体事件，每个事件都显示其在日志中的来源 `file:line`
- 可按文件、事件类型、泳道或自由文本筛选，同时作用于时间线和表格
- 按模型统计的预估 token 成本，并附上计算所用的价格表
- `--redact` 替换提示词和命令文本，方便分享报告
- `--json` 输出原始报告数据，便于脚本和 `jq` 处理
- 纯本地：无网络、无遥测、无子进程，输出为单个自包含文件

## 示例输出

```
$ npx rig-replay --repo /work/acme-api --since all \
    --claude-dir examples/demo-logs/claude/projects --codex-dir examples/demo-logs/codex \
    --now 2026-09-21T00:00:00Z --out examples/demo-report.html
rig-replay: repo /work/acme-api (all time)
  claude: 2 sessions (1 subagent), 21 events   codex: 2 sessions, 13 events
  1 possible conflict, 1 loop (edits observed in logs)
  estimated cost: $0.20 (price table: built-in, as of 2026-09-29)
  -> ./examples/demo-report.html
  note: report contains prompt and command text (known secret shapes are masked); use --redact before sharing
```

报告中会列出例如：

- **HIGH** Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df both edited it within 9m, interleaved (edits observed in logs)
- **HIGH** Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed

演示使用项目自带的合成日志。自行运行请参阅 [examples/README.md](../../examples/README.md)。

更多示例：

```
npx rig-replay                                        # current repo, last 7 days
npx rig-replay --repo ~/src/acme-api --since 2d --out /tmp/acme.html
npx rig-replay --since all --window 30m --loop-threshold 3
npx rig-replay --json --since 1d | jq '.warnings[] | .title'
npx rig-replay --redact --out shareable.html
```

## 选项

| 选项 | 默认值 | 含义 |
| --- | --- | --- |
| `--repo <path>` | cwd | 要生成报告的仓库。向上查找最近的 `.git`（目录或 worktree 的 `.git` 文件）。不存在的路径按字面使用。 |
| `--since <when>` | `7d` | `90m`、`12h`、`2d`、`1w`、日期（`2026-09-01`，UTC）或 `all`。 |
| `--out <file>` | `./rig-replay-report.html` | 输出路径。使用 `--json` 且未指定 `--out` 时，JSON 输出到 stdout。 |
| `--json` | 关闭 | 以 JSON 而非 HTML 写出报告数据。 |
| `--window <dur>` | `10m` | 判定可能冲突的时间窗口。 |
| `--loop-threshold <n>` | `4` | 判定为循环的重复次数（至少 2）。 |
| `--claude-dir <dir>` | `$CLAUDE_CONFIG_DIR/projects` 或 `~/.claude/projects` | Claude Code 的 projects 目录。 |
| `--codex-dir <dir>` | `$CODEX_HOME` 或 `~/.codex` | Codex 主目录（会自动追加 `sessions/`）。 |
| `--no-claude`、`--no-codex` | | 跳过某个来源。 |
| `--prices <file.json>` | 内置 | 用于预估成本的价格表。 |
| `--redact` | 关闭 | 将提示词和命令文本替换为 `[redacted N chars]`。 |

摘要输出到 stderr，stdout 保留给 `--json`。成功时退出码为 0（包括未找到任何会话的情况，此时消息会列出扫描过的目录）。选项错误或输出路径无法写入时退出码为 1。

价格文件格式如下。条目按顺序匹配，`match` 是模型名前缀，包含 `*` 时按 glob 处理：

```json
{
  "asOf": "2026-09-29",
  "currency": "USD",
  "models": [
    { "match": "claude-sonnet-5", "inputPerMTok": 2, "outputPerMTok": 10, "cacheReadPerMTok": 0.2, "cacheWritePerMTok": 2.5 },
    { "match": "gpt-5.3-codex", "inputPerMTok": 1.75, "outputPerMTok": 14, "cacheReadPerMTok": 0.175, "cacheWritePerMTok": 0 }
  ]
}
```

## 工作原理 / 启发式规则

1. **发现。** Claude Code：`<claude-dir>/<encoded-cwd>/<session>.jsonl` 以及 `<session>/subagents/agent-<id>.jsonl`（子代理类型取自同目录的 `.meta.json`）。编码后的目录名只用于预筛选，最终以每行的 `cwd` 字段为准。Codex：`<codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl`。较旧的日期目录以及自 `--since` 以来未修改的文件会被跳过。
2. **解析。** 每一行 JSONL 独立解析。格式错误的行和未知类型的行会被计数，并作为解析器提示报告出来，但绝不会中断运行。
   - Claude Code：`Edit`、`MultiEdit`、`Write` 和 `NotebookEdit` 视为编辑；`Bash` 视为 shell 命令；其余均视为工具调用。工具结果决定成功/失败。token 用量按每条 API 消息只计一次。
   - Codex CLI：支持当前格式（包含 `CommandExecution`、`FileChange` 和 `UserMessage` 项的 `item_completed` 事件，见于 CLI 0.154 至 0.157），并尽力支持旧的 `function_call` / `apply_patch` 格式。token 由累计 `token_count` 总数的差值得出。解析器无法识别的 rollout 会产生一条解析器提示，而不是悄无声息地返回空结果。
3. **仓库映射。** 当事件的 `cwd` 位于仓库根目录或其某个关联 worktree 内时，该事件被纳入报告（worktree 通过读取 `.git` 文件和 `.git/worktrees/*/gitdir` 找到，不运行 `git`）。文件路径转换为相对仓库的路径。仓库外的文件会显示，但不参与启发式判断。
4. **启发式规则。** 只作用于工具级事件：
   - **归属指的是“日志中观察到的编辑”。** 绕过代理编辑工具的修改（例如 shell 命令中的 `sed -i` 或 `cat > file`，或代码生成器）对 rig-replay 不可见。
   - **冲突永远是“可能的”。** 两条或更多泳道在 `--window`（默认 10m）内对同一文件进行了相邻的编辑。值得一看，但并不能证明工作丢失。跨代理或跨顶层会话时严重程度为高；父会话与其自身子代理之间为低。编辑顺序为 A、B、A 时标记为 `interleaved`。冲突按 worktree 分别计算，失败的编辑不计入。
   - **循环。** 同一条 shell 命令在同一泳道中任意 30 分钟内执行 `--loop-threshold` 次（默认 4），或同一文件被编辑同样多次。失败的运行、完全相同的编辑和回退会提高严重程度。只读命令（`ls`、`cat`、`rg`、`git status` 等）会被忽略。
5. **预估成本。** 按模型统计的 token 乘以价格表（内置价格表于其 `asOf` 日期抄录自 Anthropic 和 OpenAI 的公开价格页面）。Claude 的缓存读取和写入分别计价。对于 Codex，缓存输入按缓存读取价格计算，其余输入按输入价格计算。没有匹配条目的模型显示 “no price”。结果只是**估算**：套餐、折扣、批量或区域定价以及日志中没有的内容都不会反映。

v0.1 不包含：实时/监听模式、Claude Code 和 Codex CLI 以外的代理、行级 blame 或 diff、与 git 历史关联、跨 worktree 的重叠警告、将 Codex 多代理线程拆分为泳道、超出“隐私”一节所述模式匹配之外的密钥扫描、配置文件以及 CI 模式。

## 隐私

rig-replay 只读取本地日志文件。没有网络请求、没有遥测、没有子进程。HTML 报告完全自包含：不从任何地方加载脚本、字体、图片或样式表，因此可以通过 `file://` 离线打开。

报告中包含的内容：

- **始终遮蔽。** 在解析提示词和命令时，无论是否使用 `--redact`，常见的凭据格式都会被替换为 `[redacted secret]`。包括 OpenAI/Anthropic 的 `sk-` 密钥、GitHub 令牌（`ghp_`、`gho_`、`github_pat_` 等）、AWS 访问密钥 ID（`AKIA...`）、Slack `xox?-` 令牌、Google `AIza...` 密钥、PEM 私钥、`Authorization: Bearer|Basic ...` 和 `Bearer <token>`，以及 NAME 看起来像密钥的 `NAME=value` 赋值（`*TOKEN*`、`*SECRET*`、`*PASSWORD*`、`*API_KEY*` 等）。这是模式匹配，无法捕获所有情况。
- **除非使用 `--redact`，否则保留。** 提示词文本和 shell 命令文本（HTML 中每个事件最多 200 个字符），以及文件路径和工作目录。未开启 `--redact` 时，CLI 会在 stderr 上打印提醒。
- **从不嵌入。** 工具输出和文件内容。编辑只保留行数和一个哈希值。

报告文件以 `0600` 权限写入，并且 rig-replay 拒绝通过输出路径上的符号链接写入。请像对待生成它的日志一样对待这份报告，分享前使用 `--redact`。

## 参与贡献

欢迎提交 issue 和 pull request。

```
npm install
npm test          # vitest: unit, snapshot, labeled scenario and end-to-end CLI tests
npm run build     # tsc -> dist/
npm run example   # builds, then writes examples/demo-report.html from the synthetic demo logs
```

- 测试夹具是手写的合成数据。切勿提交真实的会话日志。
- 新的启发式规则需要在 `test/fixtures/scenarios/<name>/` 下提供带 `expected.json` 的标注场景。`sequential` 场景是误报关卡：必须保持没有任何警告。
- 遵守措辞规则：“edits observed in logs”、“possible conflict”、“estimated cost”。

## 许可证

[MIT](../../LICENSE) © 2026 canerinali
