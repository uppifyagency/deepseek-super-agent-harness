# A1, harness sempre acceso con launchd: prova dal vivo (02/11/2026)

## Why

Vlad vuole che l'harness resti acceso da solo: parte al login, riparte quando muore, e c'e' un solo
`run` per home. E' l'unita' 8 (parte launchd) del `build-plan.md` e la PR A1 del piano
`piano-allineamento-deepseek.md`. Questa PR aggiunge `harness/src/launchd.ts`, i comandi
`harness service install | uninstall | status | restart`, il lock `run.lock`, il battito
`heartbeat.json` e lo spegnimento pulito su `SIGTERM`.

Utente macOS di Vlad, non `harness`: la S e' rimandata (Riconciliazione di
`rationale.md`). Repo di prova `uppifyagency/harness-sandbox`. Ogni lane ha la sua home
`/tmp/swarm-a1/worker-<n>/home`, l'etichetta `it.delera.harness.l<n>` e il comando `/harness-l<n>`.
Codice della testa: `6c71b93` per le lane 1, 2, 3, 4, 5, 6, 7, 10; `35fa767` (attesa del bootout anche
in `uninstall`) per le lane 8, 9 e la ripetizione della 5. Trunk = `4599e1d`, con `harness run` a mano.
La home si prepara con `lane.sh`; `kill9.sh` e `perf.sh` sono le sonde. Catture in `logs/`.

Nessuna installazione su `~/.harness` ne' con l'etichetta `it.delera.harness`. A fine prova tutti i
plist `it.delera.harness.l*` sono stati tolti con `service uninstall` e nessun processo `cli.ts run`
resta. Le issue di prova #18, #19, #20, #23, #25 sono chiuse con una nota. Le PR #21, #22, #24, #26
del bot restano aperte: le unisce o le chiude Vlad.

## Lane

| Lane | Esito | Evidenza |
|---|---|---|
| 1. Trunk contro testa, dall'issue alla PR del bot | PASS | `logs/a1-trunk-vs-head.txt`. Testa (servizio l1, nessun comando dopo `install`): issue #19 -> PR #21 in 193 s. Trunk (`harness run` a mano): issue #20 -> PR #22 in 248 s, con un push rifiutato da GitHub (HTTP 500) al tentativo 1 e riuscito al 2. Niente PNG: il Chrome di chrome-devtools non ha la sessione GitHub e il repo e' privato |
| 2. `install`, poi `launchctl print` | PASS | `logs/a1-install.txt`: `state = running`, `running pid=62492 last heartbeat 2s ago`, battito al giro 1 |
| 3. `kill -9` del daemon | PASS | `logs/a1-kill9.txt`: battito nuovo dopo 13,0 s, poi 30,3 e 30,7 s (soglia 30 + 20 = 50 s) |
| 4. `service restart` dopo `run.bound` | PASS | `logs/a1-kickstart.txt`, `logs/engine-l4.log`: restart alle 16:11:53Z, `resume` riuscito alle 16:12:07Z, PR #24 |
| 5. `uninstall` + `install` col run vivo | PASS | `logs/a1-bootout.txt`: secondo `resume` alle 16:12:37Z, un solo `run.ended` (`done`) e una sola PR (#24) per il run `184b82e7`. Le lane 4 e 5 hanno usato lo stesso run, per risparmiare un ticket |
| 6. `harness run` a mano col servizio attivo | PASS | `logs/a1-lock.txt`: `already running (pid 62492)`, codice 3 |
| 7. Ambiente del daemon | PASS | `logs/a1-env.txt`: nessuna variabile `TOKEN` in `launchctl print` ne' nel processo vero (`ps eww`, solo nomi) |
| 8. Domanda del worker col servizio attivo | PASS | `logs/a1-gate.txt`, `logs/a1-gate-notifica.txt`: la domanda NOTE-A/NOTE-B compare nell'issue #25; `usernoted` presenta la notifica 0,9 s dopo `gate.opened`; la risposta "NOTE-B.md, grazie" fa ripartire il run; PR #26 con `docs/NOTE-B.md`. Screenshot dello schermo non possibile (`screencapture`: could not create image from display) |
| 9. `service uninstall` | PASS | `logs/a1-uninstall.txt`: plist sparito, `launchctl print` esce con 113, il pid non esiste piu', un secondo `uninstall` non fa niente |
| 10. Sonno del Mac | PASS solo per la simulazione | `logs/a1-sleep.txt`. **Il sonno reale (`pmset sleepnow`) non e' stato esercitato.** Daemon fermo con `kill -STOP` dalle 17:05:44 alle 17:12:18 (ora locale), issue #18 creata subito dopo lo stop. Il primo giro dopo `kill -CONT` (16:12:21Z, 3 s dopo) la passa al router |

Altre prove:
- `SIGTERM` (da `kickstart -k`) chiude con codice 0: `last exit code = 0` in `logs/a1-sigterm.txt`.
- Dopo `restart` o `uninstall`/`install`, il run ripreso non aspetta il lease di circa 120 s: riprende 4 s
  e 5 s dopo l'avvio del processo nuovo (misurato in `logs/engine-l4.log`). Lo spegnimento pulito
  libera il run in Atomic. Il lease pesa solo dopo un `kill -9` (86 s nell'unita' 5).
- Sotto launchd, con l'ambiente ridotto, funzionano `gh` (login nel portachiavi), `claude -p` (router e
  verificatore), Sol in Atomic, il token del bot dal Portachiavi (push e PR di `lunadelera-ops`) e la
  notifica con `osascript`.

**Difetto trovato e corretto durante la prova.** `service uninstall` tornava prima che launchd avesse
finito il `bootout`, e lo stato stampato diceva ancora `running pid=79038`. Ora `uninstall` aspetta che
`launchctl print` risponda 113, come gia' faceva `install` (`35fa767`).

## Variabili *_TOKEN

- L'harness non ha bisogno di nessuna variabile `*_TOKEN` (letto in `github.ts` e `workspace.ts`).
  Legge e commenta con `gh`, che usa il login di `uppifyagency` nel portachiavi (`gh auth status`:
  "keyring"). PR e push usano il token del bot, letto dal Portachiavi al momento e passato solo al
  processo figlio (`GH_TOKEN` per `gh pr`, un header per `git push`). Un `GH_TOKEN` o un `GITHUB_TOKEN`
  ereditati prenderebbero il posto del login di `gh`.
- Oggi, 02/11, il dominio launchd di Vlad **non** ha il PAT: `launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN`
  e' vuoto e il dominio `gui/501` eredita solo `SSH_AUTH_SOCK` (misurato). La shell di Vlad invece ha
  `GITHUB_PERSONAL_ACCESS_TOKEN`, e una shell di Claude Code ha anche `CLAUDE_CODE_MESSAGING_TOKEN`. Oggi
  quindi il rischio riguarda `harness run` lanciato a mano da una shell, non il servizio.
- Il plist lancia `/usr/bin/env -i K=V ... node cli.ts run` con un elenco chiuso di variabili: HOME, USER,
  LOGNAME, SHELL, LANG, PATH, TMPDIR, HARNESS_HOME, ATOMIC_CODING_AGENT_DIR. Le chiavi di un plist
  aggiungono variabili ma non ne tolgono, `env -i` invece toglie tutto il resto. Vale anche se il PAT
  torna nell'ambiente di launchd: `logs/a1-env-inherit.txt` lo mostra con due token finti. Il processo
  vero del daemon ha solo quelle 9 variabili (`ps eww`), e i suoi figli (worker, `gh`, `claude`) le
  ereditano da lui. Nessun `launchctl unsetenv` e nessuna modifica al profilo della shell: la D3 resta di Vlad.

## Perf

| Misura | Testa (servizio) | Trunk (a mano) | Regola | Esito |
|---|---|---|---|---|
| CPU media a riposo, `--every 60`, dopo il primo minuto | 0,06 % | 0,03 % | testa <= trunk + 1 punto | PASS (misurato) |
| RSS media a riposo, dopo il primo minuto | 53,6 MB | 56,0 MB | testa <= trunk + 20 % | PASS (misurato) |
| Dal `kill -9` al primo battito nuovo | 13,0 s; 30,3 s; 30,7 s | non esiste | <= 30 s + un giro (50 s con `--every 20`) | PASS (misurato) |

Come leggere i numeri:
- 60 campioni di `ps -o %cpu=,rss=` ogni 10 s per 10 minuti (`logs/perf-idle.txt`). I due processi
  giravano in parallelo, non alternati: vedono lo stesso rumore della macchina, ma e' una deviazione
  dalla sonda del piano.
- Sui 10 minuti interi la CPU della testa e' 1,67 %, per via del primo campione a 92,5 %: l'avvio
  (Atomic e il primo poll) e' caduto nella finestra solo per la testa, installata pochi secondi prima.
  Dopo il primo minuto le due medie stanno sotto la risoluzione di `ps`, che su macOS da' una media che
  decade e non il consumo dell'intervallo. La differenza di 0,03 punti e' rumore, non un costo di launchd.
- Durante la finestra altri tre daemon delle lane lavoravano su ticket. La CPU misurata e' quella del
  singolo processo, quindi la misura regge. La RSS scende nel tempo per GC e compressione della memoria:
  conta la media, non un campione.
- Ripresa: 13,0 s e' il caso tipico, con un processo vissuto piu' di 30 s. Il processo nuovo parte
  subito e il primo giro (poll e apertura del motore) dura circa 12 s. I 30,3 e 30,7 s vengono da due
  `kill -9` di fila: launchd aspetta `ThrottleInterval` (30 s) dal lancio precedente.

**Costi (misurati, equivalente API di listino; sul piano consumano limiti):**
- router: l1 0,134 $, l2 0,037 $, l4 0,148 $, l8 0,347 $, trunk 0,149 $;
- verificatore: l1 0,080 $, l4 0,074 $, l8 0,101 $, trunk 0,133 $ (due tentativi).

Il consumo di Sol non e' stato letto. I ticket completi sono stati quattro (l1, trunk, l4, l8), come
previsto. Nessun "usage limit".

## Giro di correzioni dopo la review (02/11/2026, sera)

Codice della testa: `899eff0` per le lane 4 e 5 (dalla copia di lavoro, prima di una pulizia che tocca
solo un commento e il ramo dell'errore in `engine.dispose()`), `1275655` per le lane 2, 3, 6, 9, da un
worktree in `/tmp/swarm-a1/fix/repo`. Home sotto `/tmp/swarm-a1/fix/`, etichette `it.delera.harness.l<n>`
e `it.delera.harness.l90` per la sonda. Catture in `logs/fix/`. Nessuna installazione su `~/.harness` ne'
con l'etichetta `it.delera.harness`.

**ExitTimeOut.** Il plist non lo impostava, e launchd usa 5 s. `stop` invece aspettava fino a 15 s e
`bootout` 25 s, perche' contavano su 20 s. Ora il plist scrive `ExitTimeOut` 10. `stop` da' a
`engine.dispose()` 7 s (ExitTimeOut meno 3) e poi esce da solo, prima del SIGKILL. `bootout` aspetta fino
a 15 s (ExitTimeOut piu' 5). `engine.log` registra ogni chiusura con la sua durata.

| Misura | Valori | Fonte |
|---|---|---|
| `engine.dispose()` senza run vivo | 18, 23, 33, 33, 43, 43, 58 ms | `logs/fix/engine-l90-l5.log`, `logs/fix/a1-uninstall.txt` |
| `engine.dispose()` con un run vivo nello stadio `work` | 34, 42, 48, 48 ms | `logs/fix/a1-dispose-misura.txt`, `a1-kickstart.txt`, `a1-bootout.txt` |
| `engine.dispose()` con lo stadio `verify` in corso | fallita, al massimo 1,5 s dopo il SIGTERM | `logs/fix/daemon-l90-l5.log` |
| Dal `bootout` al momento in cui launchd dimentica l'etichetta | 0,1 e 0,2 s | `logs/fix/a1-hold.txt` |

Tutte misurate. Il caso peggiore (1,5 s) sta sette volte dentro la finestra di 7 s. Il SIGTERM viene da
`kickstart -k` e da `bootout`. Il tempo e' quello registrato nell'intervallo tra il comando (al secondo)
e la riga del log (al millisecondo).

**Difetto trovato: SIGTERM durante `verify`.** Al terzo `kickstart -k` della misura il run era nello
stadio `verify` (iniziato 4 s prima). Lo strumento del verificatore non risponde alla cancellazione.
Atomic chiude con `ShutdownFailed: Workflow cleanup left uncooperative tools`, e la promessa rifiutata
dentro il gestore di `SIGTERM` faceva uscire il daemon con codice 1 e uno stack. Corretto in `899eff0`:
`engine.dispose()` scrive il fallimento in `engine.log` e non rifiuta piu', quindi `stop` esce con 0.
**Resta aperto:** dopo la ripresa il workflow figlio fallisce (`missing output "status"`), e il ticket
consuma un tentativo (run `3cd78080`, poi tentativo 2 `b7c61499`). Va reso cooperativo il passo `verify`
o idempotente la sua ripresa. Non e' in questa PR.

**HOLD, `bootout` e `bootstrap` di fila.** Su `it.delera.harness.l90`, cinque prove con il daemon vivo
(`logs/fix/a1-hold-prima.txt`, `logs/fix/a1-hold.txt`): ogni `launchctl bootstrap` subito dopo
`launchctl bootout` fallisce con `Bootstrap failed: 5: Input/output error`. launchd dimentica l'etichetta
0,1 o 0,2 s dopo, e il `bootstrap` seguente riesce. Il commento su `bootout` in `launchd.ts` resta.

| Lane | Esito | Evidenza |
|---|---|---|
| 2. `install`, poi `launchctl print` | PASS | `logs/fix/a1-install.txt`: `state = running`, `exit timeout = 10`, `ExitTimeOut` 10 nel plist, battito al giro 1 |
| 3. `kill -9` del daemon | PASS | `logs/fix/a1-kill9.txt`: pid nuovo e battito dopo 12,9 s (soglia 30 s piu' un giro), `last terminating signal = Killed: 9` |
| 4. `service restart` dopo `run.bound` | PASS | `logs/fix/a1-kickstart.txt`: restart alle 17:09:11Z, `engine disposed in 48 ms`, `last exit code = 0`, `resume` alle 17:09:26Z |
| 5. `uninstall` + `install` col run vivo | PASS | `logs/fix/a1-bootout.txt`: uninstall di l90, etichetta cambiata in l5, install. `engine disposed in 42 ms`, `resume` 18 s dopo. Un solo `run.ended` (`done`) per il run `b7c61499` e una sola PR (#28) |
| 6. `harness run` a mano col servizio attivo | PASS | `logs/fix/a1-lock.txt`: `already running (pid 55041)`, codice 3 |
| 9. `service uninstall` | PASS | `logs/fix/a1-uninstall.txt`: 0,4 s, plist sparito, `launchctl print` esce con 113, pid sparito, nessun `cli.ts run`. Un secondo `uninstall` esce con 0 |

Note sulle lane 4 e 5:
- Hanno usato il tentativo 2 dello stesso ticket della misura (issue #27), quindi un solo ticket in tutto
  il giro. Il tentativo 2 e' nato dal difetto qui sopra, non da un secondo ticket.
- `scripts/ciao.sh` era gia' su `main` del repo di prova. Il worker ha fatto un commit vuoto e il
  verificatore l'ha detto. Lo stadio `work` era breve, ma il run era vivo (dopo `run.bound`, prima di
  `run.ended`) a ogni riavvio.
- La PR #28 del bot resta aperta per Vlad. L'issue #27 e' chiusa con una nota. Alla fine nessun plist
  `it.delera.harness*` e nessun processo `cli.ts run`.

**Etichetta predefinita.** Senza `serviceLabel` nella config, `~/.harness` usa `it.delera.harness` e
ogni altra home usa `it.delera.harness.<primi 8 hex dello sha256 del percorso>`. Prima tutte le home
avevano `it.delera.harness`, e un `install` da una home di prova faceva il `bootout` del daemon vero.

**PAT.** Il 02/11 `launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN` e' vuoto (misurato). `HANDOFF.md`,
`guida-unita-S.md`, `rationale.md` e `build-plan.md` ora dicono questo.

**Costi (misurati, equivalente API di listino; sul piano consumano limiti):** router l90/l5 0,133 $ in due
risvegli, l2 0,037 $; verificatore del tentativo 2 0,095 $. Il verificatore del tentativo 1 e' stato
interrotto e non ha registrato un costo. Il consumo di Sol non e' stato letto.

## Giro 3: lo stop non costa piu' un tentativo (02/11/2026, sera)

Codice: `e6560b1` (ripresa) e `3692c6f` (lock, giro, home), provato sulla testa `3692c6f` da un worktree in
`/tmp/swarm-a1r/repo`. Home sotto `/tmp/swarm-a1r/`, etichette `it.delera.harness.r4` e `.r5`. Catture in
`logs/fix2/`. Script: `lane-r4.sh`, `lane-r5.sh`, `lock-stress.ts`.

**Causa (una domanda, due difetti).** Un run interrotto dal nostro stop deve riprendere o ripartire come lo
stesso tentativo. Andava storto in due punti.
- Dopo lo stadio `work` (riavvio durante `verify`): Atomic 0.9.63 rigioca uno stadio con schema restituendo
  il testo del checkpoint, non l'oggetto (`executor-stage-replay.ts:87-93`, contro `stage-runner-context.ts:209`
  dal vivo). `harness-ticket.ts` leggeva `result.status` su una stringa, `status` era `undefined`, e Atomic
  falliva il figlio con `missing output "status"`. Il journal del run `79a000c7` lo mostra: il checkpoint di
  `work` ha `result` come testo JSON e `structured` come oggetto.
- Prima del primo checkpoint (riavvio 8 s dopo `run.bound`, mentre `prepare` clonava): Atomic risponde
  `WORKFLOW_RUN_NOT_RESUMABLE` (zero checkpoint, zero prompt in sospeso, `workflow-tool-control.ts:617-630`).
  `engine.resume` trattava ogni errore come il lease e riprovava 20 volte ogni 15 s.

**Correzioni.** Il workflow fa `JSON.parse` del testo rigiocato. `afterResumeError` aspetta solo
`WORKFLOW_RUN_OWNED_ELSEWHERE`; con `NOT_RESUMABLE` avvia di nuovo lo stesso tentativo con un run Atomic
nuovo, e il registro accetta il secondo `run.bound`. Da quando parte `dispose()` il motore non avvia ne'
riprende run e non segna come falliti quelli che perde chiudendo la propria sessione.

| Prova | Esito | Evidenza (misurata) |
|---|---|---|
| Riavvio 2 s dopo `run.bound`, nessun checkpoint (r5, issue #39) | PASS | `logs/fix2/a1-kickstart-r5.txt`: restart alle 18:03:03Z, `refused (... not resumable): ... starting again as the same attempt` alle 18:03:25.034Z, nuovo `run.bound` 1,5 s dopo. Un solo `run.intended` (tentativo 1), un `run.ended` `done`, PR #41. Prima: 5,5 minuti di tentativi e il tentativo 1 perso |
| Riavvio 8 s dopo `run.bound`, poi 3 s dentro `verify` (r4, issue #38) | PASS | `logs/fix2/a1-kickstart-verify-r4.txt`: due `resume` riusciti (18:01:48Z, 18:04:11Z), `verify` rifatto da capo, PASS, un solo `run.intended` (tentativo 1), un `run.ended` `done`, PR #40. Prima: `missing output "status"` e tentativo 2 |
| Lock, 2 processi su un lock di un SIGKILL, 30 prove | PASS | `logs/fix2/lock-stress-dopo-2.txt`: 0 doppi, 0 senza titolare. Prima: 0 su 30 qui, 1 su 30 in una prima corsa con lo script ancora difettoso (non conservata) |
| Lock, 6 processi, 30 prove | PASS | `logs/fix2/lock-stress-dopo-6.txt`: 0 doppi, 0 senza titolare, ogni rifiuto nomina il pid vero. Prima (`lock-stress-prima-6.txt`): 11 prove su 30 con 2 o 3 titolari, e 8 processi morti con `ENOENT` su `run.lock` (L1) |

Note:
- Il caso r4 ha preso un checkpoint 5,6 s dopo `run.bound` (clone veloce), quindi la prima ripresa e'
  andata bene senza la correzione 1. Per questo c'e' r5, con il riavvio a 2 s.
- In r5 il primo daemon ha registrato `engine lost the run ... WorkflowRunControlUnavailableError` durante il
  proprio `dispose()` (18:03:03.925Z). Prima di questo giro quella riga diventava un `run.ended` `failed` e
  costava un tentativo. Ora il registro non ha nessun `run.ended` fino al `done`.
- `dispose()` e' fallito due volte (535 e 647 ms, `Workflow cleanup left uncooperative tools`): `prepare` in
  r5 e `verify` in r4 non rispondono alla cancellazione. Il run riprende lo stesso. Il passo `verify` viene
  rifatto da capo e costa un secondo verificatore.
- Nel riavvio durante `verify` il processo nuovo e' partito 44 s dopo il `restart`: launchd rispetta
  `ThrottleInterval` (30 s) dal lancio precedente.
- Test: 58, tutti verdi. Prima e dopo in `logs/fix2/test-prima-dopo-1-2.txt` e `test-prima-dopo-3-5.txt`. Il
  test di `daemonLoop` (L4) non ha un "prima" che fallisce per un'asserzione: la funzione e' nuova.

**Costi (misurati, equivalente API di listino):** router r4 0,050 e 0,086 $, r5 0,050 e 0,085 $;
verificatore r4 0,068 $, r5 0,064 $. Due ticket completi su tre concessi. Nessun "usage limit".

**Pulizia.** Plist `it.delera.harness.r4` e `.r5` rimossi, nessun `cli.ts run` sotto `/tmp/swarm-a1r`,
PR #40 e #41 chiuse senza merge con una nota e i rami cancellati, issue #38 e #39 chiuse.

**ProcessType, Background contro Standard (02/11, sera).** Il verificatore di perf a `166031e` aveva misurato
che `ProcessType` `Background` rallenta l'avvio (primi 50 s: 7,7-7,9 s di CPU contro 2,0-2,05 s; primo
battito dopo un restart 11,1 s contro 3,8-3,95 s). Mancava il costo a riposo. Sonda `processtype.zsh`, etichetta
`it.delera.harness.r9`, home `/tmp/swarm-a1r/r9/home` senza ticket (un poll al minuto, nessun risveglio del
router), plist identico salvo `ProcessType`, finestre alternate B S B S. CPU a riposo = differenza di
`ps -o time=` fra 60 e 360 s dal `bootstrap`. Catture in `logs/fix2/processtype.tsv` e `daemon-r9.log`.

| Tipo | Finestra | Primo battito | CPU 0-60 s | CPU 60-360 s | RSS a 360 s |
|---|---|---|---|---|---|
| Background | 1 | 12,7 s | 9,31 s | 0,43 s (0,14%) | 78,9 MB |
| Standard | 2 | 4,3 s | 2,07 s | 0,33 s (0,11%) | 191,5 MB |
| Background | 3 | 12,4 s | 8,86 s | 0,42 s (0,14%) | 78,5 MB |
| Standard | 4 | 4,2 s | 2,09 s | 0,33 s (0,11%) | 85,0 MB |

Tutto misurato. A riposo Standard non costa di piu': 0,33 s contro 0,42-0,43 s su 300 s. Con Background lo
stesso lavoro prende piu' tempo di CPU, compatibile con i core ad alta efficienza, ma non e' provato. La RSS di
191,5 MB della finestra 2 e' un solo campione, non spiegato: la finestra 4 da' 85,0 MB con lo stesso lavoro, e
nei log non c'e' differenza. Scelta: `Standard`. Serve lo scopo del §1 e del watchdog (A2): dopo un crash o
un restart il battito torna in circa 4 s invece di 12, senza costo a riposo misurabile.

## Lasciato a Vlad

- `service install` scrive il percorso assoluto del `cli.ts` della copia da cui viene lanciato. Il
  servizio vero va installato da un checkout che resta, non da un worktree in `/tmp`.
- L'installazione su `~/.harness` con l'etichetta `it.delera.harness` aspetta il suo si'.
- D3: togliere il PAT dalla shell. Il servizio non lo eredita in ogni caso.
- I passi `prepare` e `verify` non rispondono alla cancellazione: `dispose()` fallisce e `verify` si
  rifa' da capo dopo la ripresa (giro 3). Non costa piu' un tentativo, ma costa un verificatore.
- Atomic 0.9.63 rigioca uno stadio con schema come testo: da segnalare a monte (giro 3).
- Per A2: un battito vecchio non vuol dire per forza che il daemon e' bloccato. Dopo 6 minuti di
  `kill -STOP` il battito aveva 6 minuti, e un giro col router puo' durare fino a 10 minuti (timeout di
  `router.ts`). Anche il sonno vero del Mac, non provato qui, va distinto da un blocco.

## A1b

Seguito piccolo di A1, da un audit indipendente a `b196bf0`. Test in `73d55e8`, correzione in `b5a0a2a`.
Prova dal vivo dal worktree `Super-Agent-Harness-a1b`, etichetta `it.delera.harness.y1`, home
`/tmp/swarm-a1b/home`, handle `/harness-y1`. Catture e script in `logs/a1b/`.

**Difetti.**
- `resume` ripartiva da capo su ogni `WORKFLOW_RUN_NOT_RESUMABLE`. Atomic 0.9.63 usa lo stesso codice anche
  per run che possono avere progressi: gia' in esecuzione o con una ripresa in ammissione
  (`resume-runtime.ts:134-139`, `:515-523`) e per un claim `stale` (`:412-417`, mappato da
  `workflow-control-failure.ts:37-39`). Un secondo motore sulla stessa home poteva quindi avviare un run
  nuovo accanto a uno vivo.
- `WORKFLOW_RUN_STORAGE` chiudeva il tentativo subito.
- La ripartenza non aveva limite: un `prepare` che muore sempre prima del primo checkpoint ripartiva a ogni
  riavvio di KeepAlive.
- `harness work` non prendeva il lock: era la via per avere due motori su una home.
- Durante il passaggio del lock chi perdeva stampava `already running (pid 0)`.

**Correzioni.** `afterResumeError` riparte solo sul rifiuto che prova zero progressi, riconosciuto dal suo
testo (`has no durable checkpoint or pending prompt progress`, `workflow-tool-control.ts:618-631` e
`:712-720`). Ogni altro `NOT_RESUMABLE`, `OWNED_ELSEWHERE` e `STORAGE` aspettano, nel limite esistente di
20 prove da 15 s. Dopo 5 run Atomic legati allo stesso tentativo (eventi `run.bound`) il tentativo finisce
`failed`, non ripetibile, con il motivo nell'evidenza. `harness work` prende lo stesso lock di `run`.
Il rifiuto senza pid noto dice `already running (the lock is changing hands, pid not known yet)`.

**Run abbandonato.** Atomic 0.9.63 non ha una chiamata che chiude un run: `session.workflows` offre solo
`pause`, `quit` e `resume`, e `quit` agisce solo sui run della propria sessione. Il motore lo scrive quindi in
`engine.log` (`abandoned <id>: ...`). Dal vivo il run abbandonato `a7e00f39` resta in `pendingRuns` del
`meta.json` della sessione morta (`01a19d99`), come previsto. Lo stesso vale pero' per `3bcc55ed`, finito
`done` in un'altra sessione: quel file e' la vista per sessione del bridge, non dice se un run e' vivo.

**Test (misurati).** A `73d55e8`, solo test: 62 test, 57 passano, 5 falliscono (`logs/a1b/tests-before.txt`):
i due casi di attesa (`actual: 'start-again'` e `actual: 'fail'`, atteso `'wait'`), il limite (`actual:
'start-again'`, atteso `'give-up'`), `h.bindings is not a function` e `harness work` (`{ code: 0 }` contro
`{ code: 3, stderr: 'already running (pid N)' }`). A `b5a0a2a`: 62 su 62 (`logs/a1b/tests-after.txt`).
`tsc` pulito, `check-publish` ok.

| Prova dal vivo (issue #48) | Esito | Evidenza (misurata) |
|---|---|---|
| `harness work` mentre il servizio tiene il lock | PASS | `a1b-kickstart.txt`: `already running (pid 39859)`, `exit code: 3` |
| Riavvio 2 s dopo `run.bound`, zero progressi | PASS | `engine-y1.log`: rifiuto con il testo dei zero progressi alle 18:53:52.488Z, riga `abandoned a7e00f39`, nuovo `run.bound` `3bcc55ed` 30 ms dopo |
| Secondo riavvio 10 s dopo la ripartenza | PASS | `resume 3bcc55ed: ... "status":"running"` alle 18:54:07Z: ripreso, non ripartito |
| Esito | PASS | un `run.intended` (tentativo 1), due `run.bound`, un `run.ended` `done`, verificatore PASS, PR #54 |

Costi (misurati, equivalente API di listino): router 0,050 $, verificatore 0,081 $. Un ticket completo.

**Pulizia.** Plist `it.delera.harness.y1` rimosso, nessun processo con quella home, nessun titolare di
`run.lock.db`, PR #54 chiusa senza merge con una nota e ramo cancellato, issue #48 chiusa
(`logs/a1b/a1b-cleanup.txt`).

**Aperto.**
- Dopo il primo riavvio il nuovo processo ha aperto la sessione del motore 2 minuti dopo il restart
  (18:51:47Z contro 18:53:50Z). Nei log non c'e' la causa. Non e' toccato da questo PR e non e' spiegato.
- Il run abbandonato resta non terminale in Atomic finche' Atomic non offre una chiamata per chiuderlo:
  da chiedere a monte insieme al rigioco con schema del giro 3.
- Il riconoscimento dei zero progressi dipende dal testo del messaggio di Atomic 0.9.63. Se cambia, il
  rifiuto diventa un'attesa e poi un fallimento ripetibile: si perde un tentativo, non si avviano run doppi.
