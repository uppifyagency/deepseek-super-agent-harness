# Piano di allineamento all'articolo DeepSeek e pubblicazione

L'harness oggi copre 8 punti su 15 dell'articolo "Exploring Super-agent Design". Questo piano chiude i due punti che mancano (watchdog e lavoro speculativo). Porta a "persistente" un punto oggi parziale. Poi pubblica il progetto.
Per Vlad il risultato e' un harness che resta acceso da solo, si ripara da solo e lavora in silenzio su cio' che legge nei repo.
La regola del programma non cambia. Fatto vuol dire verificato da un modello che non ha scritto il codice, e l'harness non fa mai merge.
Le PR seguono l'ordine A0, A1, A2, A3, A5, A6, A4. Fino ad A4 sono commit su branch locali. A4 rende pubblica `uppifyagency/deepseek-super-agent-harness`, versione 0.1.0.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `skills/poteto-mode/playbooks/autopilot-stack.md` from the installed plugin. Ogni PR parte dalla precedente, quindi lo stack e' lineare. Fino ad A4 non esiste un remote. Una "PR" e' quindi un branch locale `align/<id>` con il suo report in `design/mvp/e2e/<id>/REPORT.md`. Ogni PR si ferma a merge-ready. Quando Vlad dice "unisci", la sessione radice esegue `git merge --ff-only` su `main`. A4 si ferma prima del push e aspetta che Vlad dica si' alla pubblicazione.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

Le lane live girano in parallelo solo dove non condividono stato. Ogni lane ha la sua `HARNESS_HOME`, la sua etichetta launchd e il suo comando su GitHub (`/harness-l<n>`). Cosi' le dieci lane sul repo di prova non leggono gli eventi l'una dell'altra. Una lane da terminale salva le sue "screenshot" come catture di testo `.txt`. Una lane su GitHub salva PNG prese con chrome-devtools.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, write this exact text into the standing orders and restate it in your todolist. "Piano `design/mvp/piano-allineamento-deepseek.md`. PR A0, A1, A2, A3, A5, A6, A4 in ordine, ognuna sulla precedente. Una PR e' verificata solo quando le sue caselle unit, live e perf sono tutte spuntate. Vlad unisce ogni PR con un 'unisci'. A4 pubblica solo dopo un si' esplicito di Vlad. Fatto quando `uppifyagency/deepseek-super-agent-harness` e' pubblica, il clone pulito passa `npm test` e la scansione dei segreti, e l'harness gira sotto launchd con il watchdog."
- [ ] Read these from the installed plugin at program start. Re-read them at every tick.
  - [ ] `skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `skills/swarm/SKILL.md`
  - [ ] `skills/run/SKILL.md` di Claude Code, il driver per CLI e servizi
  - [ ] `skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `skills/architect/SKILL.md`, `skills/interrogate/SKILL.md`, `skills/technical-writing/SKILL.md`, `skills/show-me-your-work/SKILL.md`
- [ ] Arm the hourly audit tick as a real `/loop` in dynamic mode, which schedules its own wake-up rather than blocking on a sleep. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from the installed plugin and the standing objective. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names. Ogni owner e' un `pstack:poteto-agent`.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] A0 e' la prima e parte da una cartella senza git.
  - [ ] A1 dopo A0.
  - [ ] A2 dopo A1, perche' legge il battito e l'etichetta launchd di A1.
  - [ ] A3 dopo A2, perche' entrambe toccano `harness/src/engine.ts`.
  - [ ] A5 dopo A3, perche' entrambe toccano `harness/src/cli.ts`.
  - [ ] A6 dopo A5, perche' il README descrive setup e doctor.
  - [ ] A4 dopo A6.
- [ ] Hold the file boundaries. A0 tocca solo la radice (`.gitignore`, `tools/`). A1 e A2 toccano solo `harness/` e `design/mvp/e2e/<id>/`. A3 tocca anche `harness/atomic/`. A4 tocca solo i documenti, `LICENSE`, `NOTICE` e la riga `PSTACK` di `engine.ts`.
- [ ] Hold the review gate. A3 cambia cio' che si vede su GitHub. A5 cambia il primo avvio. A6 e' il README pubblico. Prima del merge, queste tre PR aspettano che Vlad le riveda in chat con screenshot e video.
- [ ] Prima di scrivere il codice di A1, A2 e A3, l'owner lancia `/pstack:architect` (regola di Vlad). Scrive ogni deviazione nella sezione Riconciliazione di `design/mvp/rationale.md`.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`. Fino ad A4 il forge e' il git locale. Registralo cosi'.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch. Senza remote la PR e' il branch `align/<id>` piu' `design/mvp/e2e/<id>/REPORT.md` con la sezione Why.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on. In questo repo i controlli sono `npm test`, `npm run typecheck` e `node tools/check-publish.mjs`.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every review-bot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Before the code-ready report and babysit, and again after merge prep, record the base and head SHAs prepared by the topology owner under the execution playbook.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad unisce ogni PR verificata con `git merge --ff-only align/<id>`, partendo dalla base. Dopo un rebase un verdetto resta valido solo se il patch-id non cambia, come dice `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs in its own worktree at the PR head. Drive through the skill path or exact commands recorded in this boot recipe.

- [ ] `git worktree add /tmp/swarm-<pr-id>/worker-<n>/repo <head SHA>`, poi `cd harness && npm ci`.
- [ ] `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` (Node 26.13.0). `export HARNESS_HOME=/tmp/swarm-<pr-id>/worker-<n>/home`, poi `node src/cli.ts init --repo uppifyagency/harness-sandbox --allow uppifyagency`. In `config.json` imposta `handles` a `["/harness-l<n>"]`. Per A1 e A2 le etichette launchd sono `it.delera.harness.l<n>` e `it.delera.harness.watchdog.l<n>`.
- [ ] Deliver input only through the driver skill's commands. Su GitHub scrivi solo con `gh issue create` e `gh issue comment`, e solo sul repo di prova. Per la diagnostica usa solo comandi in lettura, cioe' `node src/cli.ts status`, `node src/cli.ts recall <id>`, `launchctl print gui/$UID/<etichetta>` e i file in `$HARNESS_HOME/logs/`.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report. Salva le catture di terminale nella stessa cartella come `<slug>.txt`. A fine lane lancia `launchctl bootout` sulle etichette della lane e chiudi le issue di prova con una nota.

## Mettere il progetto sotto git con un controllo di pubblicazione (A0)

**Depends on.** None.

**Files.**

- [ ] Create `.gitignore` con `riferimenti/`, `harness-home-sandbox/`, `**/node_modules/`, `*.sqlite`, `*.sqlite-*`, `.audit/`, `.DS_Store`.
- [ ] Create `tools/check-publish.mjs`.
- [ ] Create `tools/check-publish.test.mjs`.
- [ ] Create `tools/scrub-paths.mjs` (anticipato da A4).

**Build.**

- [ ] `git init -b main` nella radice del progetto. Nessun remote.
- [ ] `tools/check-publish.mjs` legge `git ls-files` e fallisce in tre casi, con file e riga. Il primo e' un token (`ghp_`, `gho_`, `github_pat_`, `sk-`, `-----BEGIN`). Il secondo e' un percorso assoluto dentro la home di un utente macOS. Il terzo e' un file oltre 1 MB. Quando passa stampa `check-publish: ok (<n> file)`.
- [ ] Pulisci i percorsi come previsto da A4, poi fai il commit di base con il codice e il design. Il controllo passa.

**You see.**

- [ ] `git log --oneline` mostra un commit. `git status --short` e' vuoto.
- [ ] `node tools/check-publish.mjs` stampa l'elenco dei percorsi da pulire, con file e riga, e nessun token.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tools/check-publish.test.mjs` crea un repo temporaneo con un token finto, un percorso dentro una home di macOS finta e un file da 2 MB. Controlla che ognuno faccia fallire il comando con il suo motivo. Run `node --test tools/check-publish.test.mjs`.
- [ ] `cd harness && npm test` resta 42 su 42 e `npm run typecheck` esce con 0.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk non ha git. Clona la testa in una cartella nuova e lancia `npm ci && npm test` in `harness/`. Save `a0-clone-test.txt`. Pass when il clone passa 42 test su 42.
- [ ] Lane 2. `git ls-files | grep -E '^(riferimenti|harness-home-sandbox)/'`. Save `a0-esclusi.txt`. Pass when l'uscita e' vuota.
- [ ] Lane 3. `git ls-files | grep -E 'node_modules|\.sqlite'`. Save `a0-binari.txt`. Pass when l'uscita e' vuota.
- [ ] Lane 4. Aggiungi a un file tracciato una riga `ghp_` seguita da 36 caratteri finti e lancia il controllo. Save `a0-token.txt`. Pass when esce con un codice diverso da 0 e nomina file e riga.
- [ ] Lane 5. Aggiungi un file tracciato da 2 MB. Save `a0-grande.txt`. Pass when il controllo lo nomina.
- [ ] Lane 6. Lancia il controllo sulla testa pulita. Save `a0-percorsi.txt`. Pass when nomina solo percorsi di home e l'elenco coincide con un grep a mano degli stessi percorsi.
- [ ] Lane 7. `git status --short` dopo `npm test` in `harness/`. Save `a0-status.txt`. Pass when i test non lasciano file non ignorati.
- [ ] Lane 8. Confronta l'elenco di `find` della cartella, senza gli esclusi, con `git ls-files`. Save `a0-copertura.txt`. Pass when ogni file del codice e del design e' tracciato.
- [ ] Lane 9. Cerca il valore del PAT di Vlad (letto dal profilo della shell, mai stampato) in `git log -p` con `grep -c`. Save `a0-pat.txt`. Pass when il conteggio e' 0.
- [ ] Lane 10. Lancia `harness status` da dentro il repo, con la home di prova. Save `a0-status-cli.txt`. Pass when l'uscita coincide con quella di prima di `git init`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Durata di `node tools/check-publish.mjs`. Trunk non ha il controllo, quindi vale solo un tetto assoluto.
- [ ] Probe. `hyperfine -w 2 -r 10 'node tools/check-publish.mjs'`, oppure 10 esecuzioni con `time` se hyperfine manca.
- [ ] Baseline. Trunk non ha il controllo. Registra la durata di `git ls-files` come minimo possibile.
- [ ] Rule. Fallisce oltre 2 s di mediana, perche' il controllo gira prima di ogni commit.

**Review gate.** None. A0 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" e la radice esegue `git merge --ff-only align/a0`.

## Tenere l'harness acceso con launchd (A1, unita' 8)

**Depends on.** A0.

**Files.**

- [ ] Create `harness/src/launchd.ts`.
- [ ] Edit `harness/src/cli.ts`.
- [ ] Edit `harness/src/config.ts`.
- [ ] Create `harness/test/launchd.test.ts`.
- [ ] Create `design/mvp/e2e/a1/REPORT.md`.
- [ ] Edit `design/mvp/rationale.md`.

**Build.**

- [ ] `launchd.ts` scrive il plist del daemon e lo carica. `ProgramArguments` contiene `process.execPath` (il Node di nvm), `cli.ts` e `run --every <s>`. `EnvironmentVariables` contiene `HARNESS_HOME`, `PATH` (claude, git, gh) e `ATOMIC_CODING_AGENT_DIR`, e nessuna variabile `*_TOKEN`. Il plist imposta `RunAtLoad`, `KeepAlive` e `ThrottleInterval` 30, con il log in `$HARNESS_HOME/logs/daemon.log`.
- [ ] `harness service install | uninstall | status | restart` in `cli.ts`, con `launchctl bootstrap gui/$UID`, `bootout`, `print` e `kickstart -k`. L'etichetta viene dalla config (`serviceLabel`, valore predefinito `it.delera.harness`).
- [ ] Ogni home ha un solo `run`. `run` crea `$HARNESS_HOME/run.lock` con `O_EXCL` e ci scrive il pid. Se il pid del lock e' morto, `run` riprende il lock. Un secondo `run` esce con `already running (pid <n>)`.
- [ ] Battito. Alla fine di ogni giro `run` scrive `$HARNESS_HOME/heartbeat.json` (`pid`, `at`, `tick`).
- [ ] `SIGTERM` chiude il motore con `engine.dispose()` ed esce con 0. I run vivi riprendono dopo il lease di Atomic, come gia' provato nell'unita' 5.
- [ ] Scrivi nella Riconciliazione di `rationale.md` che il daemon gira come l'utente macOS di Vlad e non come `harness`, perche' la S e' rimandata (Vlad, 02/11).

**You see.**

- [ ] `harness service status` stampa `running pid=<n> last heartbeat <s>s ago`.
- [ ] Dopo un nuovo login `launchctl print gui/$UID/it.delera.harness` dice `state = running`, senza che nessuno lanci comandi.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `launchd.test.ts`. Il plist generato passa `plutil -lint`, non contiene `TOKEN` e punta a `process.execPath`. Il lock rifiuta un secondo processo vivo e riprende quello di un pid morto. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk non ha launchd. Su trunk e sulla testa crea un'issue `/harness-l1 crea scripts/ciao.sh che stampa ciao, con un test` e misura il tempo fino alla PR del bot. Sulla testa avvia il servizio con `service install`, su trunk lancia `harness run` a mano. Save `a1-trunk-vs-head.png`. Pass when entrambe aprono una PR e la testa non chiede alcun comando dopo `install`.
- [ ] Lane 2. `service install`, poi `launchctl print`. Save `a1-install.txt`. Pass when `state = running` e il battito ha meno di 2 giri.
- [ ] Lane 3. `kill -9` del pid del daemon. Save `a1-kill9.txt`. Pass when un pid nuovo scrive il battito entro 30 s piu' un giro.
- [ ] Lane 4. `service restart` a meta' di un run (dopo `run.bound`, prima di `run.ended`). Save `a1-kickstart.txt`. Pass when il run riprende dopo il lease e finisce con una sola PR.
- [ ] Lane 5. `service uninstall`, poi `service install`, con un run vivo. Save `a1-bootout.txt`. Pass when il run riprende e il registro ha un solo `run.ended` per quel run.
- [ ] Lane 6. `harness run` a mano mentre il servizio gira. Save `a1-lock.txt`. Pass when il secondo processo esce con `already running` e codice diverso da 0.
- [ ] Lane 7. Leggi la sezione environment di `launchctl print gui/$UID/<etichetta>`. Save `a1-env.txt`. Pass when non compare nessuna variabile `TOKEN`.
- [ ] Lane 8. Una domanda del worker con il servizio attivo. Save `a1-gate.png`. Pass when la domanda compare nell'issue, arriva la notifica di macOS e una risposta in un commento fa ripartire il run.
- [ ] Lane 9. `service uninstall`. Save `a1-uninstall.txt`. Pass when il plist non c'e' piu', `launchctl print` fallisce e non resta nessun processo `cli.ts run`.
- [ ] Lane 10. `pmset sleepnow` con il servizio attivo, risveglio, poi un'issue creata durante il sonno. Save `a1-sleep.txt`. Pass when l'issue viene presa al primo giro dopo il risveglio.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. CPU e memoria del daemon a riposo (nessun run vivo), e tempo dal `kill -9` al primo battito nuovo.
- [ ] Probe. `ps -o %cpu=,rss= -p <pid>` ogni 10 s per 10 minuti, su trunk (`harness run` a mano) e sulla testa (servizio), alternati. Tre `kill -9` per il tempo di ripresa.
- [ ] Baseline. Registra prima trunk, con `harness run` lanciato a mano con `--every 60`.
- [ ] Rule. Fallisce se la CPU media della testa supera quella di trunk di oltre 1 punto, se la memoria supera trunk di oltre il 20%, o se la ripresa supera 30 s piu' un giro.

**Review gate.** None. A1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" e la radice esegue `git merge --ff-only align/a1`. Poi, se Vlad dice si', la radice lancia `service install` sulla home vera `~/.harness`.

## Aggiungere il watchdog esterno (A2, unita' 9)

**Depends on.** A1.

**Files.**

- [ ] Create `harness/src/watchdog.ts`.
- [ ] Edit `harness/src/engine.ts`.
- [ ] Edit `harness/src/service.ts`.
- [ ] Edit `harness/src/launchd.ts`.
- [ ] Edit `harness/src/cli.ts`.
- [ ] Create `harness/test/watchdog.test.ts`.
- [ ] Create `design/mvp/e2e/a2/REPORT.md`.

**Build.**

- [ ] Correggi prima il difetto trovato in A1 (giro di correzioni, `design/mvp/e2e/a1/REPORT.md`). Un riavvio durante la fase `verify` fa fallire la ripresa con `missing output "status"`, e il ticket perde un tentativo. Il watchdog causa proprio questi riavvii, quindi va chiuso prima. Prova con un `harness service restart` a meta' di `verify` e controlla che il run finisca con una sola PR e senza tentativi persi.
- [ ] Aggiungi `harness watchdog --once` e un secondo plist con `StartInterval` 120 s. Insieme sono i messaggi a orario dell'articolo (§6). Il watchdog apre il registro con `['watchdog.judged']`, come `log.ts` gia' prevede.
- [ ] Il codice controlla l'infrastruttura senza modello. Se il battito ha piu' di 2 giri, il watchdog lancia `launchctl kickstart -k`. Lo stesso vale per un processo fermo (`kill -STOP`), perche' `-k` manda `SIGKILL`.
- [ ] Un modello giudica i progressi. Prendi ogni run vivo senza `run.progress` da `stuckAfterMin` minuti (predefinito 15). Per ognuno un nuovo `claude -p` (Opus, `--tools ""`) legge gli ultimi eventi e la coda della trascrizione. Risponde `progressing`, `stuck` o `drifting` con la prova. Il watchdog scrive il risultato come `watchdog.judged`.
- [ ] Dopo un `stuck` o un `drifting` il daemon scrive `stop.intended`. Il motore lo consuma nel giro successivo e ferma il run in Atomic. Il ticket entra nella lista dell'attenzione con il motivo. Il watchdog scrive solo `watchdog.judged`.
- [ ] Il watchdog non ferma un run che ha un gate aperto. Un worker che aspetta Vlad non e' bloccato.

**You see.**

- [ ] `harness` stampa `STUCK  issue:<repo>#<n>  <motivo del watchdog>` per un run fermato.
- [ ] `$HARNESS_HOME/logs/watchdog.log` ha una riga per controllo con l'esito.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `watchdog.test.ts`. Un battito vecchio porta a un riavvio, un battito fresco no. Un run senza progressi con un gate aperto non riceve un giudizio. Un `watchdog.judged` con `stuck` porta a un solo `stop.intended`, anche se il giudizio arriva due volte. Il registro del watchdog rifiuta ogni altro tipo. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk non ha il watchdog. Su trunk e sulla testa manda `kill -STOP` al daemon. Save `a2-stop.txt`. Pass when sulla testa il daemon riparte entro 2 controlli. Su trunk resta fermo, e il fallimento va registrato contro trunk.
- [ ] Lane 2. Un brief che fa girare il worker in tondo (`aspetta che compaia /tmp/mai, controlla ogni 30 s`). Save `a2-stuck.png`. Pass when il watchdog lo giudica `stuck`, il run finisce con `stopped` e il ticket compare in `harness`.
- [ ] Lane 3. Un brief lungo ma sano (un test che dura 20 minuti con output). Save `a2-sano.txt`. Pass when il giudizio e' `progressing` e il run arriva alla PR.
- [ ] Lane 4. Un worker con una domanda aperta per 30 minuti. Save `a2-gate.txt`. Pass when il watchdog non lo giudica e non lo ferma.
- [ ] Lane 5. Manda `kill -9` al watchdog stesso. Save `a2-watchdog-kill.txt`. Pass when launchd lo rilancia al controllo successivo e nessun evento si duplica.
- [ ] Lane 6. Un brief che porta fuori obiettivo. Chiede uno script, e una parte nascosta del brief spinge il worker a riscrivere il README. Save `a2-drift.txt`. Pass when il giudizio e' `drifting` con la prova citata.
- [ ] Lane 7. Il router senza rete per 5 minuti (`claude` assente dal `PATH` del plist). Save `a2-router-giu.txt`. Pass when il watchdog lo segnala nell'attenzione e i giri ripartono quando torna.
- [ ] Lane 8. Due controlli che giudicano lo stesso run `stuck`. Save `a2-idempotente.txt`. Pass when il registro ha un solo `stop.intended` per quel run.
- [ ] Lane 9. `harness recall` sul run fermato. Save `a2-recall.txt`. Pass when la catena mostra `watchdog.judged`, `stop.intended` e `run.ended` con `stopped`.
- [ ] Lane 10. Lancia `service uninstall` e controlla che tolga anche il watchdog. Save `a2-uninstall.txt`. Pass when nessuna delle due etichette compare in `launchctl list`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Durata e consumo (token e $ di listino, misurati da `claude -p`) di un controllo, con e senza run vivi.
- [ ] Probe. 20 controlli con `harness watchdog --once`, alternando una home senza run e una con un run fermo. Trunk non ha il watchdog.
- [ ] Baseline. Trunk non ha il lavoro aggiunto. Come termine di paragone registra il consumo di una sveglia del router (0,086 $ di listino, unita' 3b).
- [ ] Rule. Un controllo senza run vivi non chiama nessun modello e dura meno di 1 s. Un controllo con giudizio fallisce oltre 0,10 $ di listino o oltre 60 s.

**Review gate.** None. A2 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" e la radice esegue `git merge --ff-only align/a2`.

## Lavorare in anticipo con ticket silenziosi (A3, unita' 12)

**Depends on.** A2.

**Files.**

- [ ] Edit `harness/src/config.ts`.
- [ ] Edit `harness/src/routing.ts`.
- [ ] Edit `harness/src/mcp.ts`.
- [ ] Edit `harness/src/service.ts`.
- [ ] Edit `harness/src/runs.ts`.
- [ ] Edit `harness/src/engine.ts`.
- [ ] Edit `harness/test/routing.test.ts`.
- [ ] Edit `harness/test/runs.test.ts`.
- [ ] Create `design/mvp/e2e/a3/REPORT.md`.

**Build.**

- [ ] Aggiungi la config per repo `speculative: { enabled, maxPerDay, budget }`. Vale solo con `listen: candidates` ed e' spenta di default.
- [ ] `decide` del router accetta `silent: true` solo su un candidato non indirizzato all'harness, e solo se il repo lo permette. `ticket.opened` porta gia' `visibility: 'silent'`.
- [ ] Un ticket silenzioso non scrive la conferma di presa in carico. Parte solo se c'e' uno slot libero e cede il posto ai ticket visibili.
- [ ] Una domanda del worker in un ticket silenzioso non va nell'issue. Il ticket si chiude con `discarded` e una riga nella lista dell'attenzione.
- [ ] Con un verdetto PASS il bot apre una PR marcata come speculativa e scrive un solo commento nell'issue, con il link. Un FAIL, un budget esaurito o uno `stuck` portano a `ticket.closed` con `discarded`. Il worktree viene rimosso e l'issue non riceve commenti.
- [ ] Se Vlad scrive `/harness` nello stesso thread mentre il ticket silenzioso gira, il ticket diventa visibile. Da quel momento ha la conferma e le domande come ogni altro ticket.

**You see.**

- [ ] Sull'issue di un bug descritto senza `/harness`, una PR del bot e un solo commento `Ho preparato una correzione in anticipo: <link>`.
- [ ] Su un candidato fallito, nessun commento e una riga `DISCARDED` in `harness`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `routing.test.ts`. Il router rifiuta `silent` su un repo senza `speculative`, oltre `maxPerDay` e su un messaggio indirizzato all'harness. `runs.test.ts`. Un FAIL di un ticket silenzioso non produce `reply.intended`. Un gate in un ticket silenzioso porta a `discarded`. Un `/harness` lo promuove a visibile. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Su trunk e sulla testa, con `listen: candidates`, crea un'issue che descrive un bug in `scripts/conta-parole.sh` senza `/harness`. Save `a3-trunk-vs-head.png`. Pass when trunk non fa niente e la testa apre una PR con un solo commento.
- [ ] Lane 2. Un candidato impossibile (correggere un file che non esiste). Save `a3-fail.png`. Pass when l'issue non ha nessun commento dell'harness e `harness` mostra `DISCARDED`.
- [ ] Lane 3. Un candidato che spinge il worker a fare una domanda. Save `a3-gate.png`. Pass when la domanda non compare nell'issue e il ticket e' `discarded`.
- [ ] Lane 4. Scrivi `/harness-l4 procedi tu` mentre il ticket silenzioso gira. Save `a3-promosso.png`. Pass when compare la conferma e il run continua visibile fino alla PR.
- [ ] Lane 5. Tre candidati con `maxPerDay` 2. Save `a3-tetto.txt`. Pass when partono 2 ticket e il terzo resta solo un `decided` senza run.
- [ ] Lane 6. Un ticket visibile arriva con tutti gli slot occupati da silenziosi. Save `a3-precedenza.txt`. Pass when il visibile parte per primo appena uno slot si libera.
- [ ] Lane 7. Repo con `listen: explicit`. Save `a3-explicit.txt`. Pass when nessun ticket silenzioso nasce.
- [ ] Lane 8. Budget del silenzioso esaurito. Save `a3-budget.png`. Pass when nessuna domanda "continuo?" compare nell'issue e il ticket e' `discarded`.
- [ ] Lane 9. Un messaggio di uno sconosciuto (non in `allowedActors`). Save `a3-sconosciuto.txt`. Pass when il filtro in codice lo scarta prima del router.
- [ ] Lane 10. Manda `kill -9` al daemon mentre gira un ticket silenzioso. Save `a3-ripresa.txt`. Pass when il run riprende, resta silenzioso e finisce con una PR o con zero commenti.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Consumo in token e $ di listino per ticket silenzioso, e attesa in piu' di un ticket visibile quando i silenziosi occupano gli slot.
- [ ] Probe. 3 issue di bug senza `/harness` e 3 con `/harness`, alternate, su trunk e sulla testa. Su trunk i silenziosi non esistono.
- [ ] Baseline. Registra prima, su trunk, il tempo dall'issue alla PR di un ticket visibile.
- [ ] Rule. Fallisce se un visibile aspetta sulla testa piu' di un giro oltre trunk, o se un silenzioso supera il suo `budget`.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2 e 4 screenshots into `design/mvp/e2e/a3/media/a3-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `design/mvp/e2e/a3/media/a3-review.mp4`. Registralo con lo screencast di chrome-devtools sull'issue della lane 1.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click. Vlad decide anche il testo del commento speculativo.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" dopo la revisione e la radice esegue `git merge --ff-only align/a3`.

## Rendere l'harness installabile con setup e doctor (A5)

**Depends on.** A3.

**Files.**

- [ ] Create `harness/src/setup.ts`.
- [ ] Edit `harness/src/cli.ts`.
- [ ] Edit `harness/src/config.ts`.
- [ ] Create `harness/test/setup.test.ts`.
- [ ] Create `design/mvp/e2e/a5/REPORT.md`.

**Build.**

- [ ] `harness doctor` controlla ogni prerequisito e stampa una riga per ognuno. La riga dice `ok`, oppure `manca` con il comando che lo sistema. I prerequisiti sono macOS, Node 26, Atomic 0.9.63 globale, il login Codex di Atomic, Claude Code con il login del piano, `gh` autenticato, pstack in `pstackDir`, il token del bot nel Portachiavi, `config.json` valido e il servizio launchd. Esce con 0 solo se tutto e' `ok`.
- [ ] `harness setup` esegue in ordine i passi che puo' fare da solo e chiede il resto. Installa Atomic 0.9.63 con `npm i -g` se manca. Clona pstack in `pstackDir` se manca. Avvia i login che mancano (`atomic`, `claude`, `gh auth login`) e aspetta che finiscano. Legge il token del bot da stdin senza eco e lo scrive nel Portachiavi. Chiede repo e login autorizzati e scrive `config.json` come `harness init`. Chiude con `harness service install` e `harness doctor`.
- [ ] `setup` e' idempotente. Salta un passo gia' fatto e stampa `gia' fatto`. Un secondo `setup` completo non cambia niente.
- [ ] Per le lane, `setup --yes --repo <owner/name> --allow <login>` gira senza domande. I login restano all'utente.

**You see.**

- [ ] Su un Mac pronto `harness doctor` stampa solo righe `ok` ed esce con 0.
- [ ] Su un nuovo utente macOS `harness setup` arriva a un `doctor` tutto `ok`. Chiede solo i login, il token e il repo.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `setup.test.ts`. Ogni controllo di `doctor` riconosce il caso `ok` e il caso `manca` con prerequisiti finti nel `PATH` e in una home temporanea. Un secondo `setup` su una home gia' pronta non scrive nessun file. Il token letto da stdin non compare mai nell'output. Run `npm test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Trunk non ha setup. Su trunk e sulla testa porta una home vuota fino alla prima issue `/harness-l1` con PR. Su trunk segui a mano i passi di `HANDOFF.md`. Sulla testa lancia `harness setup`. Save `a5-trunk-vs-head.txt`. Pass when entrambe arrivano alla PR e la testa chiede solo login, token e repo.
- [ ] Lane 2. `harness doctor` sul Mac di Vlad con la home di prova. Save `a5-doctor-ok.txt`. Pass when ogni riga e' `ok` e il codice d'uscita e' 0.
- [ ] Lane 3. Lancia `doctor` con Atomic tolto dal `PATH`. Save `a5-doctor-atomic.txt`. Pass when la riga di Atomic dice `manca` con il comando `npm i -g` e il codice d'uscita non e' 0.
- [ ] Lane 4. Lancia `doctor` con `pstackDir` che punta a una cartella vuota. Save `a5-doctor-pstack.txt`. Pass when la riga di pstack dice `manca` con il comando di clone.
- [ ] Lane 5. Lancia `setup` con `--yes` su una home vuota. Save `a5-setup.txt`. Pass when scrive `config.json`, installa il servizio della lane e chiude con `doctor` tutto `ok`.
- [ ] Lane 6. Lancia `setup` una seconda volta sulla stessa home. Save `a5-idempotente.txt`. Pass when ogni passo dice `gia' fatto` e `git status` della home e l'mtime di `config.json` non cambiano.
- [ ] Lane 7. Passa il token del bot a `setup` con una pipe. Save `a5-token.txt`. Pass when l'output, il log di setup e `config.json` contengono 0 occorrenze del token (contate con `grep -c`, mai stampate).
- [ ] Lane 8. `gh` non autenticato (`GH_CONFIG_DIR` vuoto). Save `a5-gh.txt`. Pass when `setup` avvia `gh auth login` e si ferma finche' il login non e' fatto.
- [ ] Lane 9. Passa a `--repo` un nome di repo non valido. Save `a5-repo.txt`. Pass when `setup` rifiuta con lo stesso messaggio di `loadConfig` e non scrive niente.
- [ ] Lane 10. Dopo `setup` crea un'issue `/harness-l10` sul repo di prova. Save `a5-prima-issue.png`. Pass when arriva la conferma del router e poi una PR del bot, senza altri comandi.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Durata di `harness doctor` su un Mac pronto, e tempo di Vlad (comandi e domande) da una home vuota alla prima PR.
- [ ] Probe. Lancia `doctor` 10 volte. Per il tempo di Vlad conta i comandi e le risposte della lane 1, su trunk e sulla testa.
- [ ] Baseline. Registra prima quanti comandi a mano chiede trunk, contati dai passi di `HANDOFF.md`.
- [ ] Rule. Fallisce se `doctor` supera 3 s di mediana, o se la testa chiede piu' di login, token, repo e login autorizzati.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 2 e 5 screenshots into `design/mvp/e2e/a5/media/a5-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `design/mvp/e2e/a5/media/a5-review.mp4`. E' la registrazione del terminale di `harness setup` su una home vuota.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click. Vlad decide se le domande di `setup` sono quelle giuste.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" dopo la revisione e la radice esegue `git merge --ff-only align/a5`.

## Scrivere il README pubblico con diagrammi animati (A6)

**Depends on.** A5.

**Files.**

- [ ] Edit `README.md`, in inglese. L'indice italiano di oggi passa in `docs/indice.md`.
- [ ] Create `docs/media/hero-flow.svg`.
- [ ] Create `docs/media/architecture.svg`.
- [ ] Create `docs/media/pstack-in-worker.svg`.
- [ ] Create `docs/media/setup.gif` e `docs/media/issue-to-pr.gif`.
- [ ] Create `docs/media/demo.tape`, lo script di registrazione delle GIF.
- [ ] Create `docs/statechart/<flusso>/` con modello `.tla`, `.cfg`, `.rotto.cfg`, `.mmd` e `charts.html` per i quattro flussi.
- [ ] Create `tools/check-readme.mjs`.

**Build.**

- [ ] Ogni SVG usa lo stesso stile, preso dalla tavola "Dalla segnalazione alla correzione" che Vlad ha mostrato il 02/11. Si prende solo lo stile, non i testi ne' i crediti. Il riquadro e' scuro, con griglia e sfondo propri, cosi' si legge sia nel tema chiaro sia in quello scuro di GitHub. I gruppi hanno un bordo tratteggiato e un'etichetta maiuscola monospazio (GitHub, Daemon, Atomic, Consegna). Ogni box ha un titolo, un sottotitolo monospazio e una riga di testo. I passi sono numerati sulle frecce. Le linee sono tre, con legenda. L'azzurra e' il flusso che avanza. L'arancione tratteggiata e' lo stato che torna indietro (risposte, domande, follow-up). La verde e' la consegna con una persona in mezzo. I font sono di sistema, oppure i titoli sono tracciati. Mai font esterni.
- [ ] Hero animato. Un SVG con un'animazione CSS interna segue una richiesta. Il percorso va dall'issue `/harness` al filtro, al router, al worker nel worktree e al verificatore, fino alla PR e al merge di chi la riceve. E' lo stesso percorso dell'artifact di stato, con i dati veri della prova dell'unita' 7 (issue #8, PR #9). Con `prefers-reduced-motion` l'animazione si ferma.
- [ ] Architettura. Un SVG con i tre pezzi (strato servizio di dsh, Atomic, pstack), il registro SQLite, il daemon, il watchdog, launchd e GitHub. Le linee del flusso si animano in sequenza.
- [ ] pstack nel worker. Un SVG mostra poteto-mode, il playbook, i principi e la verifica fatta da un'altra famiglia di modelli. Ognuno e' collegato alla fase `work` o al passo `verify` del workflow Atomic.
- [ ] Funzionamento. Un `sequenceDiagram` Mermaid per un ticket con domanda del worker e follow-up.
- [ ] Grafi di stato con `/pstack:statechart`, come in GHL Automation (`tmp/statechart-20261102-rirun/`). Ognuno dei quattro flussi ha un modello TLA+ controllato con TLC e disegnato come `stateDiagram-v2` con legenda. Il primo flusso e' il ciclo di vita del ticket (visibile, silenzioso, promosso, scartato, fermato). Il secondo e' il run con gate, budget e stop del watchdog. Il terzo e' la risposta nell'issue con un crash fra invio e conferma, che non produce mai due commenti. Il quarto sono gli slot dei worker, mai oltre `maxWorkers`. I modelli stanno in `docs/statechart/<flusso>/`. Il Mermaid va nel README e il `charts.html` resta accanto al modello.
  - [ ] Ogni modello ha anche una versione rotta (`.rotto.cfg`) su cui TLC fallisce. Cosi' si prova che l'invariante scatta davvero.
  - [ ] Ogni stato del grafo nomina il fatto del registro (`Kinds` in `domain.ts`) che lo rappresenta, cosi' il grafo resta legato al codice.
- [ ] Demo. `vhs` registra due GIF da `demo.tape` sul software vero. La prima mostra `harness setup` seguito da `doctor`. La seconda mostra un `harness run` che porta un'issue alla PR. Installa `vhs` con `brew install vhs` solo dopo un si' di Vlad.
- [ ] Testo. Il README dice cosa fa l'harness e per chi e'. Confronta l'harness punto per punto con l'articolo DeepSeek, con un link a ogni prova e2e. Poi ha il quickstart, i componenti con un file ciascuno, i limiti della v0.1 (un Mac, un repo, una persona) e la roadmap v0.2 (il Mac mini in azienda e le sue quattro lacune). Chiude con i crediti (DeepSeek, Atomic, pstack) e il disclaimer "Not affiliated with DeepSeek".
- [ ] `tools/check-readme.mjs` fallisce su un link relativo rotto, su un'immagine senza `alt`, su un SVG sopra 200 KB o che carica risorse esterne, e su una GIF sopra 5 MB.

**You see.**

- [ ] Sulla pagina del repo l'hero si muove in tema chiaro e in tema scuro, e il diagramma di sequenza e i quattro grafi di stato sono disegnati da GitHub.
- [ ] Ogni riga del confronto con l'articolo porta a un `REPORT.md` che esiste.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `node tools/check-readme.mjs` passa, e fallisce su un README di prova con un link rotto e un'immagine senza `alt`. Ogni SVG passa `xmllint --noout`. Run `node --test tools/check-publish.test.mjs` e `node tools/check-readme.mjs`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Su trunk il README e' l'indice in italiano. Dopo un si' di Vlad crea il repo privato di staging con `gh repo create uppifyagency/deepseek-super-agent-harness --private --source . --push`. A4 lo rendera' pubblico. Apri il README di trunk e quello della testa su quel repo con chrome-devtools. Save `a6-trunk-vs-head.png`. Pass when la testa mostra hero, architettura e quickstart nella prima schermata, e la cattura di trunk resta registrata com'e'.
- [ ] Lane 2. Tema chiaro di GitHub. Save `a6-light.png`. Pass when ogni riquadro scuro ha bordi netti sulla pagina chiara e il testo e' leggibile.
- [ ] Lane 3. Tema scuro con `emulate` di chrome-devtools. Save `a6-dark.png`. Pass when ogni riquadro resta distinto dalla pagina scura e il testo e' leggibile.
- [ ] Lane 4. Animazione dell'hero. Prendi due screenshot a 1 s di distanza. Save `a6-hero-t0.png`. Pass when i due fotogrammi sono diversi e il percorso arriva alla PR.
- [ ] Lane 5. Emula `prefers-reduced-motion`. Save `a6-reduced.png`. Pass when l'hero e' fermo e completo.
- [ ] Lane 6. Larghezza di telefono, 390 px. Save `a6-mobile.png`. Pass when non c'e' scorrimento orizzontale e i diagrammi restano leggibili.
- [ ] Lane 7. Mermaid e grafi di stato. Rilancia TLC su ogni modello e sulla sua versione rotta, poi apri il README di staging. Save `a6-mermaid.png`. Pass when ogni modello passa, ogni versione rotta fallisce con il suo invariante, e GitHub disegna il diagramma di sequenza e i quattro grafi senza errore.
- [ ] Lane 8. Clicca ogni link del confronto con l'articolo. Save `a6-link.txt`. Pass when ognuno apre un file che esiste nel repo.
- [ ] Lane 9. Confronta le GIF con il registro della home usata per registrarle. Save `a6-gif.txt`. Pass when gli id di issue e PR nelle GIF esistono davvero su `harness-sandbox`.
- [ ] Lane 10. Un lettore nuovo (un agente senza contesto) legge solo il README e risponde a cosa fa, come si installa e cosa non fa. Save `a6-lettore.txt`. Pass when le tre risposte coincidono con il codice.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Peso totale dei media del README e tempo fino al primo disegno della pagina del repo.
- [ ] Probe. `du -ch docs/media/*` e una traccia di performance di chrome-devtools sulla pagina di staging. Ripeti tre volte su trunk e tre sulla testa, alternate.
- [ ] Baseline. Registra prima il tempo di trunk, con il README di solo testo.
- [ ] Rule. Fallisce se i media superano 8 MB in tutto, o se il primo disegno della testa supera trunk di oltre 1 s.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1, 3, 4 e 6 screenshots into `design/mvp/e2e/a6/media/a6-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of the change in a lane worktree. Save it as `design/mvp/e2e/a6/media/a6-review.mp4`. E' lo screencast di chrome-devtools che scorre il README di staging in tema chiaro e scuro.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click. Vlad approva testo, diagrammi e animazioni.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice "unisci" dopo la revisione e la radice esegue `git merge --ff-only align/a6`.

## Pubblicare la repo su uppifyagency (A4)

**Depends on.** A6.

**Files.**

- [ ] Create `LICENSE` (MIT, Copyright (c) 2026 Vlad Vrinceanu, confermato da Vlad il 02/11).
- [ ] Create `NOTICE` con l'attribuzione MIT di dsh-superagent (Copyright (c) 2026 DeepSeek Harness Team), da cui viene lo strato servizio.
- [ ] Edit `README.md` solo se serve. A6 scrive il README. A4 controlla che il disclaimer "Not affiliated with DeepSeek" sia nella prima schermata.
- [ ] Edit `harness/package.json` con `version` 0.1.0.
- [ ] Edit `HANDOFF.md`, `design/**/*.md` e `design/mvp/e2e/**/logs/*` con i percorsi resi relativi a `~`.
- [ ] Edit `harness/src/engine.ts` per leggere `PSTACK` dalla config (`pstackDir`, valore predefinito `~/src/pstack-claude/plugins/pstack`).

**Build.**

- [x] Anticipato in A0, perche' i percorsi sarebbero entrati nella storia del primo commit. `tools/scrub-paths.mjs` sostituisce il prefisso assoluto della home con `~/` nei file tracciati. Una seconda esecuzione non cambia niente.
- [x] Anticipato in A0 per lo stesso motivo. Il passaggio che indicava file e riga del PAT di Vlad ora dice solo "nel profilo della shell", in `HANDOFF.md`, `rationale.md`, `build-plan.md`, `guida-unita-S.md` e `e2e/method/REPORT.md`.
- [x] Vlad tiene il token del bot com'e' (02/11). Tolta dai documenti pubblicati la frase sugli scope e sulla scadenza del token del bot (`HANDOFF.md`, `rationale.md`). Il verificatore di A0 ha trovato altri fatti personali: l'email in `e2e/unit6/REPORT.md`, i percorsi di sessione di Claude nei log, il dump di init del router in `e2e/unit3/` e il nome di un repo privato. Vlad ha deciso di toglierli tutti (03/11). `tools/scrub-paths.mjs` li riscrive con `<sessione>`, `<utente>` e `<altro-repo>`, e il dump e' cancellato.
- [x] `tools/check-publish.mjs` riconosce anche i percorsi `-Users-<utente>-` e `/private/tmp/claude-<uid>/`, con un test per ognuno. Rifiuta anche le email (tranne `noreply@anthropic.com` e `*@users.noreply.github.com`) e i termini privati elencati in `.git/info/private-terms`, un file che non entra mai nel repo.
- [ ] `tools/check-publish.test.mjs` copre anche le regole `sk-` e `-----BEGIN`. `tools/scrub-paths.mjs` riscrive per intero un percorso del repo che contiene spazi. Il deslop di A0 ha trovato entrambe le lacune.
- [ ] `node tools/check-publish.mjs` passa. `gitleaks detect --log-opts=--all` passa su tutta la storia. Installa gitleaks con `brew install gitleaks` solo dopo un si' di Vlad.
- [ ] Dopo il si' esplicito di Vlad, `git push` sul repo privato di staging creato in A6, poi `gh repo edit uppifyagency/deepseek-super-agent-harness --visibility public --accept-visibility-change-consequences --description "Unofficial implementation of DeepSeek's Super-agent design, built on pstack and Atomic"`, poi i topic `deepseek`, `super-agent`, `pstack`, `atomic`, `claude-code`, il tag `v0.1.0` e una release che elenca i punti dell'articolo coperti e quelli che mancano.

**You see.**

- [ ] `https://github.com/uppifyagency/deepseek-super-agent-harness` mostra il README, la `LICENSE` che GitHub riconosce come MIT e il badge della lingua TypeScript.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Lancia `npm test` e `npm run typecheck` sulla testa. Lancia `node --test tools/check-publish.test.mjs`. Lancia `tools/scrub-paths.mjs` due volte di seguito. La seconda volta non cambia niente (`git diff --exit-code`).

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured `swarm workers` model at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Fai un clone pulito di trunk e uno della testa, poi lancia `npm ci && npm test` in `harness/`. Save `a4-clone.txt`. Pass when entrambi passano e la testa non ha percorsi di home.
- [ ] Lane 2. Lancia `gitleaks detect --log-opts=--all` sul clone della testa. Save `a4-gitleaks.txt`. Pass when riporta 0 segreti.
- [ ] Lane 3. Cerca il valore del PAT e del token del bot (letti dal Portachiavi e dal profilo della shell, mai stampati) in `git log -p --all`. Save `a4-token.txt`. Pass when entrambi i conteggi sono 0.
- [ ] Lane 4. Lancia `grep -rn 'zshrc' $(git ls-files)`. Save `a4-zshrc.txt`. Pass when non resta nessuna indicazione su dove sta il PAT.
- [ ] Lane 5. Un utente macOS di prova senza `~/src/pstack-claude` lancia `harness status` con `pstackDir` in config. Save `a4-pstackdir.txt`. Pass when il comando legge il percorso dalla config.
- [ ] Lane 6. Segui il README da zero in una home vuota fino a `harness status`. Save `a4-readme.txt`. Pass when ogni comando del README funziona com'e' scritto.
- [ ] Lane 7. Dopo il push lancia `gh repo view uppifyagency/deepseek-super-agent-harness --json visibility,licenseInfo`. Save `a4-repo.txt`. Pass when l'uscita contiene `PUBLIC` e `MIT`.
- [ ] Lane 8. Apri la pagina del repo con chrome-devtools. Save `a4-pagina.png`. Pass when README e licenza si vedono e nessuna immagine o link e' rotto.
- [ ] Lane 9. Confronta `git ls-files` del clone pubblico con l'elenco di A0. Save `a4-file.txt`. Pass when non compare `riferimenti/`, `harness-home-sandbox/` o un `.sqlite`.
- [ ] Lane 10. L'harness sotto launchd continua a girare dalla cartella dopo il push. Save `a4-servizio.txt`. Pass when `harness service status` dice `running` con un battito recente.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Dimensione del repo pubblicato e durata del clone.
- [ ] Probe. Lancia `git count-objects -vH` e `time git clone` sul repo, tre volte.
- [ ] Baseline. Registra prima `du -sh` dei file tracciati in A0.
- [ ] Rule. Fallisce se il repo supera 5 MB, perche' vorrebbe dire che e' entrato un file escluso.

**Review gate.** None. A4 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Base and verdict are current under the execution playbook and the patch-id rule in `playbooks/shipping.md`.
- [ ] Vlad dice si' alla pubblicazione (titolare della licenza Vlad Vrinceanu, confermato il 02/11). Solo allora `git merge --ff-only align/a4` e `gh repo create ... --push`.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Aggiorna la tabella dell'articolo nell'artifact di stato e in `HANDOFF.md`. §1 persistente, §6 e §3.4 passano a fatto.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

Per decidere la forma non serviva un prototipo, perche' il dominio la prevede gia'. `harness/src/domain.ts` ha `visibility: 'silent'`, `stop.intended` e `watchdog.judged`. `harness/src/log.ts` apre gia' il registro del watchdog con il solo `watchdog.judged`. Restano tre fatti da provare, e le lane li provano. Il primo e' che `launchctl kickstart -k` riavvia un processo fermato con `kill -STOP` (A2, lane 1). Il secondo e' che l'harness prende al risveglio un'issue creata durante il sonno del Mac (A1, lane 10). Il terzo e' che `stop.intended` ferma davvero un run in Atomic 0.9.63, perche' oggi nessuno lo consuma (A2, lane 2).

## Appendix B. Alternatives rejected

- Pubblicare prima e lavorare con PR su GitHub. Scartata perche' Vlad ha chiesto di finire il lavoro e poi pubblicare.
- Watchdog dentro il processo del daemon. Scartata perche' l'articolo lo vuole esterno, e un daemon fermo non puo' giudicare se stesso.
- Un watchdog che e' una sessione agente con tutti gli strumenti, a cui chiedere in linguaggio naturale perche' qualcosa e' fallito (articolo §6, secondo paragrafo). Rimandato. Il giudizio dei progressi basta a chiudere il punto. `harness recall` risponde gia' al "perche'" con la catena degli eventi.
- Ticket silenziosi che pubblicano anche quando falliscono. Scartata perche' l'articolo dice di scartare i risultati inutili. Un commento di fallimento che nessuno ha chiesto consuma l'attenzione di Vlad.
- Dieci lane che condividono la stessa home e la stessa etichetta launchd. Scartata perche' si leggerebbero gli eventi a vicenda. Ogni lane ha home, etichetta e comando suoi.
- Includere `riferimenti/` nella repo pubblica. Scartata perche' contiene l'articolo di DeepSeek con le immagini, gli export DeepWiki e cloni di repo di terzi.

## Appendix C. Risks

- Consumo degli abbonamenti (A1, A2, A3). Le lane con un run completo consumano circa 0,4 $ di listino per ticket (misurato nell'unita' 6). Con circa 20 run nelle lane la stima e' di 8 $ di listino. Sul piano questo consumo si paga in finestre d'uso, non in spesa. Oggi un limite del piano raggiunto fa perdere un tentativo (T2 non fatto). Se compare "usage limit", l'owner ferma le lane e lo dice.
- Il daemon gira come Vlad (A1). Il confine delle credenziali resta aperto finche' la S non e' fatta. Vlad lo accetta solo sul repo di prova. L'owner non mette repo reali nella config di `~/.harness`.
- Lavoro speculativo su repo di terzi (A3). Con `listen: candidates` i messaggi di altri entrano nel prompt del router. Va acceso solo su repo privati di Vlad finche' la S non e' fatta.
- Licenza AGPL di mupdf (A4). La repo non contiene Atomic e lo carica dall'installazione globale, quindi non lo distribuisce. E' un'inferenza dal codice di `engine.ts` (`loadAtomic`), non un parere legale.
- Fatti della macchina in `HANDOFF.md` (A4). I nomi delle voci del Portachiavi e dell'account bot restano pubblici. Non sono segreti, ma dicono a chi legge dove guardare. L'owner li elenca a Vlad prima del push.
- Mac in sonno (A1). Durante il sonno launchd non lancia niente. Il poll rilegge da 5 minuti prima del cursore, e la lane 10 prova che basta.

## Appendix D. Links and reading list

- Prima di toccare il codice si leggono `HANDOFF.md`, `design/mvp/rationale.md` (sezione Riconciliazione), `design/mvp/build-plan.md`, `riferimenti/dsh-superagent/articolo/articolo.md` §3.4 e §6.
- `skills/how/SKILL.md` per A2 (come il motore ferma un run in Atomic) e A3 (percorso di `decide` fino a `ticket.opened`).
- `skills/interrogate/SKILL.md` per A3, perche' cambia cio' che l'harness fa su GitHub senza essere chiamato.
- Traccia delle decisioni per `skills/show-me-your-work/SKILL.md` in `.audit/allineamento-deepseek.tsv`, locale.
