# rig-replay

**Kodlama ajanlarınızın tek bir depoda yaptığı her şeyi tek bir zaman çizelgesinde görün ve ikisinin birden düzenlediği dosyayı birleştirmeden (merge) önce yakalayın.**

[English](../../README.md) · Türkçe · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Português (BR)](README.pt-BR.md)

> Bu bir çeviridir. Güncel ve bağlayıcı metin [İngilizce README](../../README.md)'dir.

rig-replay, bir depoda çalışmış tüm Claude Code ve Codex oturumlarının yerel kayıtlarını (log) okur ve tek bir çevrimdışı HTML zaman çizelgesi üretir. **Olası çakışmaları** (iki ajanın ya da oturumun aynı dosyayı kısa aralıkla düzenlemesi) ve **döngüleri** (aynı komutun ya da düzenlemenin tekrar tekrar yapılması) öne çıkarır; her birini bunu gösteren kayıt satırlarına bağlar.

```
npx rig-replay --since 2d
```

Kurulum gerekmez (Node.js 22 veya üstü). Deponuzun içinde çalıştırın; `./rig-replay-report.html` dosyasını yazar.

## Önce / sonra

**Önce:** iki terminalde iki ajan, iki farklı formatta kayıtlar ve sorunu birleştirme anında fark etmek.

```
terminal 1  claude  "add pagination to the orders endpoint"   edits src/db.ts
terminal 2  codex   "fix the flaky db test"                   edits src/db.ts, runs npm test 5x
terminal 1  claude                                            edits src/db.ts again

~/.claude/projects/-work-acme-api/*.jsonl        one format, one file per session
~/.codex/sessions/2026/09/20/rollout-*.jsonl     another format, another place

...at merge time: "who changed the query in src/db.ts?"
```

**Sonra:** tek komut, tek zaman çizelgesi ve uyarı sizi bekliyor.

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

"Sonra" çıktısı, pakette gelen sentetik demo kayıtlarından alınmıştır ([examples/README.md](../../examples/README.md)).

## Özellikler

- Bir depodaki tüm Claude Code ve Codex CLI oturumları için tek bir HTML zaman çizelgesi
- Alt ajanlar (subagent) ve bağlı git worktree'leri kendi şeritlerinde (lane) gösterilir
- İki şerit aynı dosyayı kısa aralıkla düzenlediğinde **olası çakışma** uyarısı
- Aynı komut ya da düzenleme tekrarlandığında **döngü** uyarısı; başarısız çalıştırmalar ve geri almalar önem derecesini artırır
- Her uyarı ilgili olaylara, her olay da kayıttaki kaynağına (`file:line`) bağlanır
- Dosya, olay türü, şerit ya da serbest metinle filtreleme; hem zaman çizelgesinde hem tabloda
- Model başına tahmini token maliyeti, onu üreten fiyat tablosunun yanında
- `--redact` istem (prompt) ve komut metinlerini gizler, böylece rapor paylaşılabilir
- `--json` betikler ve `jq` için ham rapor verisini yazar
- Yalnızca yerel: ağ yok, telemetri yok, alt süreç (child process) yok, tek ve kendi kendine yeten bir dosya

## Örnek çıktı

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

Rapor bundan sonra örneğin şunları listeler:

- **HIGH** Possible conflict on src/db.ts: claude 5b0c1d2e and codex 01a0e0df both edited it within 9m, interleaved (edits observed in logs)
- **HIGH** Repeated command: npm test -- db: codex 01a0e0df ran it 5x in 12m, 4 failed

Demo, pakette gelen sentetik kayıtları kullanır. Kendiniz çalıştırmak için [examples/README.md](../../examples/README.md) dosyasına bakın.

Diğer örnekler:

```
npx rig-replay                                        # current repo, last 7 days
npx rig-replay --repo ~/src/acme-api --since 2d --out /tmp/acme.html
npx rig-replay --since all --window 30m --loop-threshold 3
npx rig-replay --json --since 1d | jq '.warnings[] | .title'
npx rig-replay --redact --out shareable.html
```

## Seçenekler

| Seçenek | Varsayılan | Anlamı |
| --- | --- | --- |
| `--repo <path>` | cwd | Raporlanacak depo. En yakın `.git`'e (bir dizin ya da worktree `.git` dosyası) kadar yukarı çıkar. Var olmayan bir yol olduğu gibi kullanılır. |
| `--since <when>` | `7d` | `90m`, `12h`, `2d`, `1w`, bir tarih (`2026-09-01`, UTC) ya da `all`. |
| `--out <file>` | `./rig-replay-report.html` | Çıktı yolu. `--json` verilip `--out` verilmezse JSON stdout'a yazılır. |
| `--json` | kapalı | Rapor verisini HTML yerine JSON olarak yazar. |
| `--window <dur>` | `10m` | Olası çakışmalar için zaman penceresi. |
| `--loop-threshold <n>` | `4` | Döngü sayılan tekrar sayısı (en az 2). |
| `--claude-dir <dir>` | `$CLAUDE_CONFIG_DIR/projects` ya da `~/.claude/projects` | Claude Code projeler dizini. |
| `--codex-dir <dir>` | `$CODEX_HOME` ya da `~/.codex` | Codex ana dizini (sonuna `sessions/` eklenir). |
| `--no-claude`, `--no-codex` | | Bir kaynağı atlar. |
| `--prices <file.json>` | yerleşik | Tahmini maliyet için kullanılan fiyat tablosu. |
| `--redact` | kapalı | İstem ve komut metinlerini `[redacted N chars]` ile değiştirir. |

Özet stderr'e yazılır; stdout `--json` için ayrılmıştır. Başarıda çıkış kodu 0'dır (hiç oturum bulunamadığında da; bu durumda mesaj taranan dizinleri listeler). Hatalı seçeneklerde ya da yazılamayan bir çıktı yolunda çıkış kodu 1'dir.

Bir fiyat dosyası şöyle görünür. Girdiler sırayla denenir; `match` bir model adı önekidir, `*` içeriyorsa glob olarak yorumlanır:

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

## Nasıl çalışır / sezgisel kurallar

1. **Keşif.** Claude Code: `<claude-dir>/<encoded-cwd>/<session>.jsonl` ve `<session>/subagents/agent-<id>.jsonl` (alt ajan türü yandaki `.meta.json` dosyasından gelir). Kodlanmış dizin adı yalnızca ön filtredir; asıl kararı her satırdaki `cwd` alanı verir. Codex: `<codex-dir>/sessions/YYYY/MM/DD/rollout-*.jsonl`. Eski tarih klasörleri ve `--since`'ten beri değişmemiş dosyalar atlanır.
2. **Ayrıştırma.** Her JSONL satırı ayrı ayrı ayrıştırılır. Bozuk satırlar ve bilinmeyen satır türleri sayılır ve ayrıştırıcı notu olarak raporlanır. Çalışmayı asla durdurmazlar.
   - Claude Code: `Edit`, `MultiEdit`, `Write` ve `NotebookEdit` düzenlemedir; `Bash` kabuk komutudur; geri kalan her şey araç çağrısıdır. Araç sonuçları başarılı/başarısız durumunu belirler. Token kullanımı her API mesajı için bir kez sayılır.
   - Codex CLI: güncel format (`CommandExecution`, `FileChange` ve `UserMessage` öğeleri içeren `item_completed` olayları, CLI 0.154 ile 0.157 arasında görüldü) desteklenir; eski `function_call` / `apply_patch` formatı elden geldiğince desteklenir. Tokenlar, kümülatif `token_count` toplamlarının farklarından hesaplanır. Ayrıştırıcının tanıyamadığı bir rollout sessizce boş sonuç vermek yerine bir ayrıştırıcı notu üretir.
3. **Depo eşleme.** Bir olay, `cwd`'si depo kökünün ya da bağlı worktree'lerinden birinin içindeyse rapora dahil edilir (worktree'ler `git` çalıştırılmadan, `.git` dosyaları ve `.git/worktrees/*/gitdir` okunarak bulunur). Dosya yolları depoya göreli hâle getirilir. Depo dışındaki dosyalar gösterilir ama sezgisel kurallarda dikkate alınmaz.
4. **Sezgisel kurallar.** Yalnızca araç düzeyindeki olaylar üzerinde çalışırlar:
   - **Atıf, kayıtlarda gözlenen düzenlemeler demektir.** Ajanın düzenleme araçlarını atlayan bir düzenleme (örneğin bir kabuk komutundaki `sed -i` ya da `cat > file`, veya bir kod üreteci) rig-replay için görünmezdir.
   - **Çakışmalar her zaman "olası"dır.** İki ya da daha fazla şeridin aynı dosyada `--window` (varsayılan 10m) içinde art arda düzenleme yapması. Bakmaya değer, ancak işin kaybolduğunun kanıtı değildir. Farklı ajanlar ya da üst düzey oturumlar arasında önem derecesi yüksektir; bir ana oturum ile kendi alt ajanları arasında düşüktür. Düzenlemeler A, B, A sırasıyla yapıldıysa `interleaved` işaretlenir. Çakışmalar her worktree için ayrı hesaplanır ve başarısız düzenlemeler sayılmaz.
   - **Döngüler.** Aynı kabuk komutunun tek bir şeritte herhangi bir 30 dakikalık aralıkta `--loop-threshold` kez (varsayılan 4) çalıştırılması ya da aynı dosyanın o kadar düzenlenmesi. Başarısız çalıştırmalar, birebir aynı düzenlemeler ve geri almalar önem derecesini artırır. Salt okuma komutları (`ls`, `cat`, `rg`, `git status`, ...) yok sayılır.
5. **Tahmini maliyet.** Model başına tokenlar fiyat tablosuyla çarpılır (yerleşik tablo, `asOf` tarihinde Anthropic ve OpenAI'ın herkese açık fiyat sayfalarından alınmıştır). Claude önbellek okuma ve yazmaları ayrı fiyatlandırılır. Codex için önbellekten gelen girdi önbellek okuma fiyatından, girdinin geri kalanı girdi fiyatından hesaplanır. Eşleşen girdisi olmayan modeller "no price" gösterir. Sonuç bir **tahmindir**: planlar, indirimler, toplu (batch) ya da bölgesel fiyatlandırma ve kayıtlarda olmayan her şey yansıtılmaz.

v0.1 kapsamı dışında: canlı/izleme modu, Claude Code ve Codex CLI dışındaki ajanlar, satır düzeyinde blame ya da diff, git geçmişiyle ilişkilendirme, worktree'ler arası çakışma uyarıları, Codex çoklu ajan iş parçacıklarını şeritlere bölme, Gizlilik bölümünde anlatılan desen tabanlı maskelemenin ötesinde gizli bilgi taraması, yapılandırma dosyası ve CI modu.

## Gizlilik

rig-replay yalnızca yerel kayıt dosyalarını okur. Ağ bağlantısı, telemetri ve alt süreç yoktur. HTML rapor tamamen kendi kendine yeterlidir: hiçbir yerden betik, yazı tipi, görsel ya da stil dosyası yüklemez; bu yüzden `file://` üzerinden çevrimdışı açılabilir.

Rapora neler girer:

- **Her zaman maskelenir.** İyi bilinen kimlik bilgisi biçimleri, istemler ve komutlar ayrıştırılırken `--redact` olsun olmasın `[redacted secret]` ile değiştirilir. Kapsam: OpenAI/Anthropic `sk-` anahtarları, GitHub tokenları (`ghp_`, `gho_`, `github_pat_`, ...), AWS erişim anahtarı kimlikleri (`AKIA...`), Slack `xox?-` tokenları, Google `AIza...` anahtarları, PEM özel anahtarları, `Authorization: Bearer|Basic ...` ve `Bearer <token>`, ayrıca NAME kısmı gizli bilgiye benzeyen `NAME=value` atamaları (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`, `*API_KEY*`, ...). Bu bir desen eşleştirmesidir, dolayısıyla her şeyi yakalayamaz.
- **`--redact` vermedikçe korunur.** İstem metni ve kabuk komut metni (HTML'de olay başına en fazla 200 karakter), ayrıca dosya yolları ve çalışma dizinleri. `--redact` kapalıyken CLI stderr'e bir hatırlatma yazar.
- **Asla gömülmez.** Araç çıktıları ve dosya içerikleri. Düzenlemeler satır sayılarına ve bir özete (hash) indirgenir.

Rapor dosyası `0600` izinleriyle yazılır ve rig-replay çıktı yolundaki bir sembolik bağlantı (symlink) üzerinden yazmayı reddeder. Raporu, üretildiği kayıtlar kadar hassas kabul edin ve paylaşmadan önce `--redact` kullanın.

## Katkıda bulunma

Issue ve pull request'ler memnuniyetle karşılanır.

```
npm install
npm test          # vitest: unit, snapshot, labeled scenario and end-to-end CLI tests
npm run build     # tsc -> dist/
npm run example   # builds, then writes examples/demo-report.html from the synthetic demo logs
```

- Test fikstürleri sentetiktir ve elle yazılmıştır. Gerçek oturum kayıtlarını asla commit etmeyin.
- Yeni sezgisel kurallar, `test/fixtures/scenarios/<name>/` altında `expected.json` içeren etiketli bir senaryo gerektirir. `sequential` senaryosu yanlış pozitif kapısıdır: uyarısız kalmalıdır.
- İfade kurallarına uyun: "edits observed in logs", "possible conflict", "estimated cost".

## Lisans

[MIT](../../LICENSE) © 2026 canerinali
