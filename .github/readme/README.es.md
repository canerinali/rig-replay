# rig-replay

**Ve lo que hicieron todos tus agentes de programación en un repositorio, en una sola línea de tiempo, y detecta el archivo que dos de ellos editaron antes de hacer merge.**

[English](../../README.md) · [Türkçe](README.tr.md) · [简体中文](README.zh-CN.md) · Español · [Português (BR)](README.pt-BR.md)

> Esta es una traducción. El [README en inglés](../../README.md) es la versión de referencia.

rig-replay lee los logs locales de todas las sesiones de Claude Code y Codex que trabajaron en un repositorio y genera una única línea de tiempo HTML sin conexión. Señala los **posibles conflictos** (dos agentes o sesiones editando el mismo archivo con poco tiempo de diferencia) y los **bucles** (el mismo comando o la misma edición repetidos), cada uno enlazado a las líneas de log que lo muestran.

```
npx rig-replay --since 2d
```

No hay nada que instalar (Node.js 22 o superior). Ejecútalo dentro de tu repositorio; escribe `./rig-replay-report.html`.

## Antes / después

**Antes:** dos agentes en dos terminales, logs en dos formatos distintos, y te enteras al hacer merge.

```
terminal 1  claude  "add pagination to the orders endpoint"   edits src/db.ts
terminal 2  codex   "fix the flaky db test"                   edits src/db.ts, runs npm test 5x
terminal 1  claude                                            edits src/db.ts again

~/.claude/projects/-work-acme-api/*.jsonl        one format, one file per session
~/.codex/sessions/2026/09/20/rollout-*.jsonl     another format, another place

...at merge time: "who changed the query in src/db.ts?"
```

**Después:** un comando, una línea de tiempo, y la advertencia ya te está esperando.

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

La salida de "después" proviene de los logs sintéticos de demostración incluidos ([examples/README.md](../../examples/README.md)).

## Funcionalidades

- Una línea de tiempo HTML para todas las sesiones de Claude Code y Codex CLI de un repositorio
- Los subagentes y los git worktrees vinculados tienen su propio carril
- Advertencias de **posible conflicto** cuando dos carriles editan el mismo archivo con poco tiempo de diferencia
- Advertencias de **bucle** cuando se repite el mismo comando o edición; los fallos y las reversiones aumentan la severidad
- Cada advertencia enlaza a los eventos exactos, y cada evento muestra su origen `file:line` en los logs
- Filtros por archivo, tipo de evento, carril o texto libre, tanto en la línea de tiempo como en la tabla
- Costo estimado de tokens por modelo, junto a la tabla de precios que lo produjo
- `--redact` reemplaza el texto de prompts y comandos para poder compartir un informe
- `--json` escribe los datos del informe en bruto para scripts y `jq`
- Solo local: sin red, sin telemetría, sin procesos hijos, un único archivo autocontenido

## Ejemplo de salida

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

El informe muestra entonces, por ejemplo:

- **HIGH** Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df both edited it within 9m, interleaved (edits observed in logs)
- **HIGH** Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed

La demo usa logs sintéticos incluidos. Consulta [examples/README.md](../../examples/README.md) para ejecutarla tú mismo.

Más ejemplos:

```
npx rig-replay                                        # current repo, last 7 days
npx rig-replay --repo ~/src/acme-api --since 2d --out /tmp/acme.html
npx rig-replay --since all --window 30m --loop-threshold 3
npx rig-replay --json --since 1d | jq '.warnings[] | .title'
npx rig-replay --redact --out shareable.html
```

## Opciones

| Opción | Valor por defecto | Significado |
| --- | --- | --- |
| `--repo <path>` | cwd | Repositorio sobre el que informar. Sube hasta el `.git` más cercano (un directorio o un archivo `.git` de worktree). Una ruta que no existe se usa literalmente. |
| `--since <when>` | `7d` | `90m`, `12h`, `2d`, `1w`, una fecha (`2026-09-01`, UTC) o `all`. |
| `--out <file>` | `./rig-replay-report.html` | Ruta de salida. Con `--json` y sin `--out`, el JSON va a stdout. |
| `--json` | desactivado | Escribe los datos del informe como JSON en lugar de HTML. |
| `--window <dur>` | `10m` | Ventana para posibles conflictos. |
| `--loop-threshold <n>` | `4` | Repeticiones que cuentan como bucle (al menos 2). |
| `--claude-dir <dir>` | `$CLAUDE_CONFIG_DIR/projects` o `~/.claude/projects` | Directorio de proyectos de Claude Code. |
| `--codex-dir <dir>` | `$CODEX_HOME` o `~/.codex` | Directorio base de Codex (se le añade `sessions/`). |
| `--no-claude`, `--no-codex` | | Omite una fuente. |
| `--prices <file.json>` | integrada | Tabla de precios usada para el costo estimado. |
| `--redact` | desactivado | Reemplaza el texto de prompts y comandos por `[redacted N chars]`. |

El resumen va a stderr, y stdout queda reservado para `--json`. El código de salida es 0 si todo va bien (también cuando no se encuentran sesiones; en ese caso el mensaje indica los directorios revisados). Es 1 ante opciones incorrectas o una ruta de salida en la que no se puede escribir.

Un archivo de precios tiene este aspecto. Las entradas se comprueban en orden, y `match` es un prefijo del nombre del modelo, o un glob cuando contiene `*`:

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

## Cómo funciona / heurísticas

1. **Descubrimiento.** Claude Code: `<claude-dir>/<encoded-cwd>/<session>.jsonl` más `<session>/subagents/agent-<id>.jsonl` (el tipo de subagente viene del `.meta.json` contiguo). El nombre de directorio codificado es solo un prefiltro; decide el campo `cwd` de cada línea. Codex: `<codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl`. Se omiten las carpetas de fechas antiguas y los archivos no modificados desde `--since`.
2. **Análisis.** Cada línea JSONL se analiza por separado. Las líneas mal formadas y los tipos de línea desconocidos se cuentan y se informan como notas del parser. Nunca detienen una ejecución.
   - Claude Code: `Edit`, `MultiEdit`, `Write` y `NotebookEdit` son ediciones; `Bash` es un comando de shell; todo lo demás es una llamada a herramienta. Los resultados de las herramientas marcan éxito/fallo. El uso de tokens se cuenta una vez por mensaje de la API.
   - Codex CLI: se admite el formato actual (eventos `item_completed` con elementos `CommandExecution`, `FileChange` y `UserMessage`, observados en CLI 0.154 a 0.157), y el formato antiguo `function_call` / `apply_patch` se admite en la medida de lo posible. Los tokens se obtienen de las diferencias de los totales acumulados de `token_count`. Un rollout que el parser no reconoce produce una nota del parser en lugar de no devolver nada en silencio.
3. **Asignación al repositorio.** Un evento pertenece al informe cuando su `cwd` está dentro de la raíz del repositorio o de uno de sus worktrees vinculados (que se encuentran leyendo los archivos `.git` y `.git/worktrees/*/gitdir`, sin ejecutar `git`). Las rutas de archivo pasan a ser relativas al repositorio. Los archivos fuera del repositorio se muestran pero las heurísticas los ignoran.
4. **Heurísticas.** Se aplican solo a eventos a nivel de herramienta:
   - **La atribución significa ediciones observadas en los logs.** Una edición que no pasó por las herramientas de edición del agente (por ejemplo `sed -i` o `cat > file` en un comando de shell, o un generador de código) es invisible para rig-replay.
   - **Los conflictos son siempre "posibles".** Dos o más carriles que editaron el mismo archivo con ediciones consecutivas dentro de `--window` (por defecto 10m). Merece una revisión, pero no prueba que se haya perdido trabajo. La severidad es alta entre agentes o sesiones de nivel superior, y baja entre una sesión padre y sus propios subagentes. Se marca `interleaved` cuando las ediciones fueron A, B, A. Los conflictos se calculan por worktree y las ediciones fallidas no cuentan.
   - **Bucles.** El mismo comando de shell ejecutado `--loop-threshold` veces (por defecto 4) en cualquier intervalo de 30 minutos en un carril, o el mismo archivo editado esas veces. Las ejecuciones fallidas, las ediciones idénticas y las reversiones aumentan la severidad. Los comandos de solo lectura (`ls`, `cat`, `rg`, `git status`, ...) se ignoran.
5. **Costo estimado.** Los tokens por modelo se multiplican por la tabla de precios (la tabla integrada se copió de las páginas públicas de precios de Anthropic y OpenAI en su fecha `asOf`). Las lecturas y escrituras de caché de Claude se cobran por separado. En Codex, la entrada en caché se cobra al precio de lectura de caché y el resto de la entrada al precio de entrada. Los modelos sin una entrada coincidente muestran "no price". El resultado es una **estimación**: no refleja planes, descuentos, precios por lotes o regionales ni nada que no esté en los logs.

Fuera del alcance de la v0.1: modo en vivo/observación, agentes distintos de Claude Code y Codex CLI, blame o diffs a nivel de línea, correlación con el historial de git, advertencias de solapamiento entre worktrees, dividir los hilos multiagente de Codex en carriles, escaneo de secretos más allá del enmascaramiento por patrones descrito en Privacidad, un archivo de configuración y un modo CI.

## Privacidad

rig-replay solo lee archivos de log locales. No hay red, ni telemetría, ni procesos hijos. El informe HTML es totalmente autocontenido: no carga scripts, fuentes, imágenes ni hojas de estilo de ningún sitio, así que puede abrirse sin conexión desde `file://`.

Lo que acaba en el informe:

- **Siempre enmascarado.** Los formatos de credenciales conocidos se reemplazan por `[redacted secret]` al analizar prompts y comandos, con o sin `--redact`. Eso incluye claves `sk-` de OpenAI/Anthropic, tokens de GitHub (`ghp_`, `gho_`, `github_pat_`, ...), IDs de claves de acceso de AWS (`AKIA...`), tokens `xox?-` de Slack, claves `AIza...` de Google, claves privadas PEM, `Authorization: Bearer|Basic ...` y `Bearer <token>`, y asignaciones `NAME=value` donde NAME parece un secreto (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, ...). Es coincidencia de patrones, así que no puede detectarlo todo.
- **Se conserva salvo que uses `--redact`.** El texto de los prompts y de los comandos de shell (hasta 200 caracteres por evento en el HTML), además de las rutas de archivo y los directorios de trabajo. La CLI imprime un recordatorio en stderr cuando `--redact` está desactivado.
- **Nunca se incrusta.** Las salidas de las herramientas y el contenido de los archivos. Las ediciones se reducen a recuentos de líneas y un hash.

El archivo del informe se escribe con modo `0600`, y rig-replay se niega a escribir a través de un enlace simbólico en la ruta de salida. Trata el informe como los logs de los que procede y usa `--redact` antes de compartirlo.

## Contribuir

Los issues y pull requests son bienvenidos.

```
npm install
npm test          # vitest: unit, snapshot, labeled scenario and end-to-end CLI tests
npm run build     # tsc -> dist/
npm run example   # builds, then writes examples/demo-report.html from the synthetic demo logs
```

- Los fixtures de prueba son sintéticos y están escritos a mano. Nunca hagas commit de logs de sesiones reales.
- Las nuevas heurísticas necesitan un escenario etiquetado en `test/fixtures/scenarios/<name>/` con un `expected.json`. El escenario `sequential` es la barrera contra falsos positivos: debe seguir sin advertencias.
- Respeta las reglas de redacción: "edits observed in logs", "possible conflict", "estimated cost".

## Licencia

[MIT](../../LICENSE) © 2026 canerinali
