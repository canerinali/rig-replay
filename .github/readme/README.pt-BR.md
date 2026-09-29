# rig-replay

**Veja o que todos os seus agentes de programação fizeram em um repositório, em uma única linha do tempo, e pegue o arquivo que dois deles editaram antes do merge.**

[English](../../README.md) · [Türkçe](README.tr.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · Português (BR)

> Esta é uma tradução. O [README em inglês](../../README.md) é a versão de referência.

O rig-replay lê os logs locais de todas as sessões do Claude Code e do Codex que trabalharam em um repositório e gera uma única linha do tempo em HTML, que funciona offline. Ele destaca **possíveis conflitos** (dois agentes ou sessões editando o mesmo arquivo com pouco tempo de diferença) e **loops** (o mesmo comando ou a mesma edição repetidos), cada um com link para as linhas de log que o mostram.

```
npx rig-replay --since 2d
```

Não há nada para instalar (Node.js 22 ou mais recente). Rode dentro do seu repositório; ele grava `./rig-replay-report.html`.

## Antes / depois

**Antes:** dois agentes em dois terminais, logs em dois formatos, e você só descobre na hora do merge.

```
terminal 1  claude  "add pagination to the orders endpoint"   edits src/db.ts
terminal 2  codex   "fix the flaky db test"                   edits src/db.ts, runs npm test 5x
terminal 1  claude                                            edits src/db.ts again

~/.claude/projects/-work-acme-api/*.jsonl        one format, one file per session
~/.codex/sessions/2026/09/20/rollout-*.jsonl     another format, another place

...at merge time: "who changed the query in src/db.ts?"
```

**Depois:** um comando, uma linha do tempo, e o aviso já está esperando por você.

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

A saída do "depois" vem dos logs sintéticos de demonstração incluídos no projeto ([examples/README.md](../../examples/README.md)).

## Recursos

- Uma linha do tempo em HTML para todas as sessões do Claude Code e do Codex CLI em um repositório
- Subagentes e git worktrees vinculados ganham suas próprias faixas
- Avisos de **possível conflito** quando duas faixas editam o mesmo arquivo com pouco tempo de diferença
- Avisos de **loop** quando o mesmo comando ou edição se repete; falhas e reversões aumentam a severidade
- Cada aviso aponta para os eventos exatos, e cada evento mostra sua origem `file:line` nos logs
- Filtros por arquivo, tipo de evento, faixa ou texto livre, tanto na linha do tempo quanto na tabela
- Custo estimado de tokens por modelo, ao lado da tabela de preços que o gerou
- `--redact` substitui o texto de prompts e comandos para que o relatório possa ser compartilhado
- `--json` grava os dados brutos do relatório para scripts e `jq`
- Somente local: sem rede, sem telemetria, sem processos filhos, um único arquivo autocontido

## Exemplo de saída

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

O relatório então lista, por exemplo:

- **HIGH** Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df both edited it within 9m, interleaved (edits observed in logs)
- **HIGH** Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed

A demo usa logs sintéticos incluídos no projeto. Veja [examples/README.md](../../examples/README.md) para rodá-la você mesmo.

Mais exemplos:

```
npx rig-replay                                        # current repo, last 7 days
npx rig-replay --repo ~/src/acme-api --since 2d --out /tmp/acme.html
npx rig-replay --since all --window 30m --loop-threshold 3
npx rig-replay --json --since 1d | jq '.warnings[] | .title'
npx rig-replay --redact --out shareable.html
```

## Opções

| Opção | Padrão | Significado |
| --- | --- | --- |
| `--repo <path>` | cwd | Repositório a ser analisado. Sobe até o `.git` mais próximo (um diretório ou um arquivo `.git` de worktree). Um caminho que não existe é usado literalmente. |
| `--since <when>` | `7d` | `90m`, `12h`, `2d`, `1w`, uma data (`2026-09-01`, UTC) ou `all`. |
| `--out <file>` | `./rig-replay-report.html` | Caminho de saída. Com `--json` e sem `--out`, o JSON vai para o stdout. |
| `--json` | desligado | Grava os dados do relatório como JSON em vez de HTML. |
| `--window <dur>` | `10m` | Janela para possíveis conflitos. |
| `--loop-threshold <n>` | `4` | Repetições que contam como loop (no mínimo 2). |
| `--claude-dir <dir>` | `$CLAUDE_CONFIG_DIR/projects` ou `~/.claude/projects` | Diretório de projetos do Claude Code. |
| `--codex-dir <dir>` | `$CODEX_HOME` ou `~/.codex` | Diretório base do Codex (`sessions/` é acrescentado). |
| `--no-claude`, `--no-codex` | | Ignora uma fonte. |
| `--prices <file.json>` | embutida | Tabela de preços usada para o custo estimado. |
| `--redact` | desligado | Substitui o texto de prompts e comandos por `[redacted N chars]`. |

O resumo vai para o stderr, e o stdout fica reservado para `--json`. O código de saída é 0 em caso de sucesso (inclusive quando nenhuma sessão é encontrada; nesse caso a mensagem informa os diretórios verificados). É 1 para opções inválidas ou um caminho de saída que não pode ser gravado.

Um arquivo de preços tem esta forma. As entradas são verificadas em ordem, e `match` é um prefixo do nome do modelo, ou um glob quando contém `*`:

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

## Como funciona / heurísticas

1. **Descoberta.** Claude Code: `<claude-dir>/<encoded-cwd>/<session>.jsonl` mais `<session>/subagents/agent-<id>.jsonl` (o tipo de subagente vem do `.meta.json` ao lado). O nome de diretório codificado é só um pré-filtro; quem decide é o campo `cwd` de cada linha. Codex: `<codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl`. Pastas de datas antigas e arquivos não modificados desde `--since` são ignorados.
2. **Análise.** Cada linha JSONL é analisada separadamente. Linhas malformadas e tipos de linha desconhecidos são contados e relatados como notas do parser. Eles nunca interrompem uma execução.
   - Claude Code: `Edit`, `MultiEdit`, `Write` e `NotebookEdit` são edições; `Bash` é um comando de shell; todo o resto é uma chamada de ferramenta. Os resultados das ferramentas definem sucesso/falha. O uso de tokens é contado uma vez por mensagem da API.
   - Codex CLI: o formato atual (eventos `item_completed` com itens `CommandExecution`, `FileChange` e `UserMessage`, vistos nas versões 0.154 a 0.157 da CLI) é suportado, e o formato antigo `function_call` / `apply_patch` é suportado na medida do possível. Os tokens vêm das diferenças dos totais acumulados de `token_count`. Um rollout que o parser não reconhece gera uma nota do parser em vez de silenciosamente não retornar nada.
3. **Mapeamento do repositório.** Um evento entra no relatório quando seu `cwd` está dentro da raiz do repositório ou de um de seus worktrees vinculados (encontrados lendo os arquivos `.git` e `.git/worktrees/*/gitdir`, sem executar `git`). Os caminhos de arquivo passam a ser relativos ao repositório. Arquivos fora do repositório são exibidos, mas ignorados pelas heurísticas.
4. **Heurísticas.** Elas rodam apenas sobre eventos no nível de ferramenta:
   - **Atribuição significa edições observadas nos logs.** Uma edição que não passou pelas ferramentas de edição do agente (por exemplo `sed -i` ou `cat > file` em um comando de shell, ou um gerador de código) é invisível para o rig-replay.
   - **Conflitos são sempre "possíveis".** Duas ou mais faixas que editaram o mesmo arquivo com edições consecutivas dentro de `--window` (padrão 10m). Vale a pena olhar, mas não prova que trabalho foi perdido. A severidade é alta entre agentes ou sessões de nível superior, e baixa entre uma sessão pai e seus próprios subagentes. `interleaved` é marcado quando as edições foram A, B, A. Os conflitos são calculados por worktree, e edições que falharam não contam.
   - **Loops.** O mesmo comando de shell executado `--loop-threshold` vezes (padrão 4) em qualquer intervalo de 30 minutos em uma faixa, ou o mesmo arquivo editado esse número de vezes. Execuções com falha, edições idênticas e reversões aumentam a severidade. Comandos somente leitura (`ls`, `cat`, `rg`, `git status`, ...) são ignorados.
5. **Custo estimado.** Os tokens por modelo são multiplicados pela tabela de preços (a tabela embutida foi copiada das páginas públicas de preços da Anthropic e da OpenAI na sua data `asOf`). Leituras e gravações de cache do Claude são cobradas separadamente. No Codex, a entrada em cache é cobrada pelo preço de leitura de cache e o restante da entrada pelo preço de entrada. Modelos sem entrada correspondente mostram "no price". O resultado é uma **estimativa**: planos, descontos, preços em lote ou regionais e qualquer coisa que não esteja nos logs não são considerados.

Fora do escopo da v0.1: modo ao vivo/observação, agentes além do Claude Code e do Codex CLI, blame ou diffs por linha, correlação com o histórico do git, avisos de sobreposição entre worktrees, dividir threads multiagente do Codex em faixas, varredura de segredos além do mascaramento por padrões descrito em Privacidade, arquivo de configuração e modo CI.

## Privacidade

O rig-replay lê apenas arquivos de log locais. Não há rede, telemetria nem processos filhos. O relatório HTML é totalmente autocontido: não carrega scripts, fontes, imagens nem folhas de estilo de lugar nenhum, então pode ser aberto offline via `file://`.

O que vai para o relatório:

- **Sempre mascarado.** Formatos conhecidos de credenciais são substituídos por `[redacted secret]` quando prompts e comandos são analisados, com ou sem `--redact`. Isso cobre chaves `sk-` da OpenAI/Anthropic, tokens do GitHub (`ghp_`, `gho_`, `github_pat_`, ...), IDs de chave de acesso da AWS (`AKIA...`), tokens `xox?-` do Slack, chaves `AIza...` do Google, chaves privadas PEM, `Authorization: Bearer|Basic ...` e `Bearer <token>`, e atribuições `NAME=value` em que NAME parece um segredo (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, ...). É correspondência de padrões, então não pega tudo.
- **Mantido, a menos que você use `--redact`.** Texto de prompts e de comandos de shell (até 200 caracteres por evento no HTML), além de caminhos de arquivo e diretórios de trabalho. A CLI imprime um lembrete no stderr quando `--redact` está desligado.
- **Nunca incorporado.** Saídas de ferramentas e conteúdo de arquivos. As edições são reduzidas a contagens de linhas e um hash.

O arquivo do relatório é gravado com modo `0600`, e o rig-replay se recusa a gravar através de um link simbólico no caminho de saída. Trate o relatório como os logs de onde ele veio e use `--redact` antes de compartilhá-lo.

## Contribuindo

Issues e pull requests são bem-vindos.

```
npm install
npm test          # vitest: unit, snapshot, labeled scenario and end-to-end CLI tests
npm run build     # tsc -> dist/
npm run example   # builds, then writes examples/demo-report.html from the synthetic demo logs
```

- As fixtures de teste são sintéticas e escritas à mão. Nunca faça commit de logs reais de sessões.
- Novas heurísticas precisam de um cenário rotulado em `test/fixtures/scenarios/<name>/` com um `expected.json`. O cenário `sequential` é a barreira contra falsos positivos: ele precisa continuar sem avisos.
- Mantenha as regras de redação: "edits observed in logs", "possible conflict", "estimated cost".

## Licença

[MIT](../../LICENSE) © 2026 canerinali
