# Piano di costruzione dell'MVP (raddrizzato dopo l'E2E del 02/11/2026)

Ogni unita' finisce in uno stato provato sul software reale: SQLite vero, Atomic vero, GitHub vero
sul repo di prova `harness-sandbox`. Non si usano mock. Le correzioni alle API vengono da
`e2e/*/REPORT.md` e sono elencate in `rationale.md`, sezione Riconciliazione.

**Fatto il 02/11:**
- Node 26.13.0 tramite nvm. Quello di sistema in `/usr/local` aspetta ancora il comando `sudo` di Vlad.
- Atomic 0.9.63 installato. Login Codex pronto, con `gpt-6.1-sol`. Anthropic non loggato.
- Unita' 0 (prova del confine con il motore): tutto PASS, con correzioni alle API.
- **Unita' 1 (`harness/src/log.ts`): chiusa.** 14 test su 14 (`npm test`), `tsc` pulito. Replay su 5
  seed da 300 bozze: stessi id e stesse viste. Tre processi che scrivono insieme per circa 1,8 s:
  4.398 righe, tutte con id distinto. Con l'orologio dentro `idOf` falliscono 8 test su 14.
- **Unita' 2 (fonte GitHub, filtro in codice, observe): chiusa.** 18 test su 18. Sul repo
  `uppifyagency/harness-sandbox`, issue #1:
  - una richiesta con `/harness` passa;
  - un commento non indirizzato viene scartato (`not-addressed`), e cosi' un commento con il
    marcatore dell'harness (`own-message`);
  - un nuovo commento non rigenera l'issue (versione = hash del testo, non `updated_at`);
  - una modifica vera crea un trigger nuovo;
  - a cursore cancellato, il poll successivo da' solo duplicati.

  Una modifica e' sfuggita a un poll fatto 2 s dopo e l'ha presa il poll seguente. L'ipotesi e' una
  risposta vecchia dell'API, non riprodotta. Da qui il poll rilegge 5 minuti prima del cursore.
  Chiamata dell'harness: `/harness` invece di `@harness`, finche' non c'e' il bot.
  Bug trovato ripetendo la suite: `openLog` passava a WAL prima di impostare `busy_timeout`, e
  aprendo il database in due processi insieme falliva 1 volta su 25. Corretto: ora 0 fallimenti su
  150 esecuzioni del test di concorrenza.
- **Unita' 3 (router su Claude Code, MCP, risposte, `harness ask`): chiusa.** 24 test su 24. Sul repo
  di prova:
  - observe: il router unisce 4 messaggi dell'issue #1 in un solo `would-accept`, con titolo e
    criterio di fatto, e non scrive su GitHub;
  - `harness ask`: risponde dal terminale e ricorda il contesto fra le sveglie;
  - auto: l'issue #2 diventa un ticket, l'issue viene iscritta e la conferma di presa in carico
    viene pubblicata;
  - crash fra il POST e `reply.settled` (issue #3): al riavvio il marcatore viene trovato e i
    commenti restano 1;
  - il commento dell'harness viene scartato come `own-message`.

  Prove in `e2e/unit3/`. Trovato strada facendo:
  1. **Tool del router.** La lista di tool negati lasciava raggiungibili Artifact, CronCreate,
     RemoteTrigger, PublishPlugin, SendMessage e Workflow. Ora il router parte con `--tools ""` piu'
     i quattro tool MCP, e l'evento di init lo conferma: ha esattamente quei quattro.
  2. **Ritardo delle liste di GitHub, confermato.** Un'issue creata un secondo prima del poll non
     era ancora nella lista. La finestra di 5 minuti serve.
  3. **Il costo del router cresce a ogni sveglia** (misurato, costo equivalente API riportato da
     `claude -p`, che sul piano consuma limiti): 0,31, 0,37, 0,42, 0,49, 0,53, 0,56 $ con 5 turni
     ciascuna. La causa e' la sessione ripresa, che rilegge tutta la storia. Una sessione nuova con
     un turno costa 0,06 $. **Nuova unita' 3b:** ruotare la sessione del router (sessione nuova
     quando il costo per sveglia supera una soglia), con `next` che riporta la tabella dei ticket
     aperti e le ultime decisioni, cosi' la memoria resta nel registro.
- **Unita' 3b (rotazione del router): chiusa.** 26 test su 26. `next` restituisce una lavagna: ticket
  aperti con la loro issue, ultime 15 decisioni, ultimi 10 scambi con Vlad, voci in attesa di Vlad.
  Il router riparte da una sessione nuova quando l'ultima sveglia ha superato 0,45 $
  (`routerRotateAboveUsd` nel config).

  Prova dal vivo, stessa domanda prima e dopo la rotazione: risposta equivalente presa dalla lavagna
  (i ticket #2 e #3, la #1 in attesa, le domande precedenti). Costo misurato per sveglia: 0,62 $ con
  la sessione ripresa, 0,086 $ con quella nuova, 0,15 $ alla sveglia dopo. Il valore 0,086 beneficia
  quasi certamente della cache dei prompt, ancora calda: una sessione nuova a freddo costa di piu'
  (la prima di oggi 0,31 $).
- **Unita' 4 (motore Atomic, fase `work` con Sol): chiusa.** 30 test su 30. Con l'utente di Vlad
  (S rimandata). Due ticket in parallelo sul repo di prova: un commit corretto ciascuno nel worktree,
  nessun push, `run.bound`/`run.progress`/`run.ended` nel registro, mandato di pstack in 12 turni su
  12. **Costo misurato di un ticket di una riga: 0,12 $ (prezzo di catalogo riportato da Atomic, sul
  piano Codex non addebitato), circa 55 s, 6 turni**. Trovati e corretti: corsa sul clone, forma di
  `getRun`. Prove in `e2e/unit4/`, deviazioni nella Riconciliazione.
- **Unita' 8, parte budget: chiusa.** 42 test su 42. Issue #16: budget 0,03 $, fermata a 0,134 $, la
  domanda "continuo con 0,27 $?" compare nell'issue, "Sì" avvia il tentativo 2 sulla sessione e sul commit
  del primo, PR #17. Atomic ferma il budget fra i passi, non dentro una fase. Restano launchd (8) e
  watchdog (9): servizi sul Mac, serve il si' di Vlad. Prove in `e2e/unit8/`.
- **Unita' 10 (worker in parallelo, recall dopo la rotazione): chiusa.** 40 test su 40. Issue #10-#12
  insieme con 2 worker: mai piu' di 2 run vivi, il terzo parte quando uno slot si libera. Dopo una
  rotazione forzata il router risponde su un ticket chiuso seguendo 9 `recall`. Prove in `e2e/unit10/`.
- **Unita' 7 (follow-up): chiusa.** 38 test su 38. Issue #8 / PR #9: un commento durante il run arriva
  al worker in 3 s senza turni del router; dopo la fine, due commenti sulla PR avviano i tentativi 2 e 3
  sulla stessa PR, il 3 sulla sessione del 2 (fork). Trovati e corretti: il verificatore non vedeva i
  follow-up (bocciava cio' che Vlad aveva chiesto), `forkFromSessionId` ignorato senza `context: 'fork'`.
  Prove in `e2e/unit7/`.
- **Unita' 6 (verifica con Opus, PR del bot): chiusa.** 35 test su 35. Issue #5: Sol committa, Opus
  (`claude -p` nuovo, sola lettura controllata dopo) approva, il bot `lunadelera-ops` fa il push e apre la
  PR #6 con il verdetto e `Closes #5`, il router riporta l'esito, il worktree sparisce. Ripetere publish
  ridà la stessa PR. **Costo misurato del ticket: circa 0,42 $** (Sol 0,12, Opus 0,10, router 0,20).
  Tentativo 2 dopo un FAIL e commit dopo il verdetto provati solo in test. Prove in `e2e/unit6/`.
- **Unita' 5 (gate: domande del worker nell'issue): chiusa.** 33 test su 33. Issue #4 del repo di
  prova: il worker chiede, la domanda compare nell'issue con le opzioni (e una notifica macOS), `kill -9`
  del daemon con la domanda aperta, risposta in un commento, ripresa dopo il lease (circa 86 s), la
  domanda riproposta ritrova lo stesso gate e il worker committa `NOTE-B.md`. Router: 0,36 $ per
  accettare, chiedere e normalizzare (misurato). Il blocco del push e' provato solo in test. La ripresa
  di un run legato (prevista nell'unita' 8) e' anticipata qui. Prove in `e2e/unit5/`.
- Unita' 0b (pstack, guard, credenziali, worktree): PASS parziale. Correzioni in rationale. La prova
  sulle credenziali e' fallita, e da qui viene l'unita' S.

**Decisioni di Vlad che sbloccano le unita':**
- **D1. Ruoli e modelli: decisa il 02/11.** Router e verificatore su Claude Code con Opus (piano di
  Vlad), worker Sol (`gpt-6.1-sol`) in Atomic sul login Codex. Il login Anthropic in Atomic non serve
  piu'. Serve invece il login di Claude Code per l'utente `harness` (unita' S).
- **D2. Account bot GitHub e utente macOS `harness`.** Account bot: `lunadelera-ops`,
  collaboratore Write su `harness-sandbox`. Il token classic e' nel Portachiavi di Vlad
  (servizio `harness-bot-github`). **L'utente macOS e' rimandato (Vlad, 02/11):** le unita' 4-10
  girano con l'utente di Vlad, solo su `harness-sandbox` (privato), con guard e senza push del worker.
  La S **blocca l'unita' 11** e qualunque repo reale o testo di terzi.
- **D3. Il PAT in chiaro nel profilo della shell:** spostarlo nel Portachiavi? Il 02/11 non era
  nell'ambiente di launchd (`launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN` vuoto, misurato).
  Non blocca l'MVP, una volta che l'harness gira come `harness`.

**Da fare, decisi da Vlad il 02/11 (non urgenti):**
- **T1. Budget in consumo, non in $.** Router, Sol e Opus girano su abbonamenti (ChatGPT, Claude): il $
  riportato e' prezzo di listino, non spesa. Tetto per ticket in token (`maxTokens` di Atomic) piu' la
  durata; la domanda nell'issue parla di token. Il $ resta solo come misura relativa del consumo.
- **T2. Limite del piano raggiunto.** Riconoscere "usage limit reached" (Sol, router, verificatore),
  mettere in pausa la coda fino al reset della finestra, avvisare Vlad e ripartire da soli, senza
  consumare tentativi. Oggi quel caso fa fallire il run e brucia il tentativo successivo.

| # | Consegna | Prova |
|---|---|---|
| 1 | `domain.ts` e `log.ts`: `transact`, `idOf`, spill, ricostruzione delle viste, mappa `RunKey -> AtomicRunId` | `node --test`. Ripassare gli eventi in un database vuoto da' gli stessi id e le stesse viste. La stessa bozza due volte da' una sola riga |
| S | **Confine delle credenziali.** Utente macOS `harness`, account bot, token fine-grained limitato al repo di prova, login Atomic (Codex) e Claude Code dell'utente `harness`, bridge atomic-remote non globale, plist senza `*_TOKEN`, `~/.harness/worktrees` | Rifare la prova M3 come utente `harness`. `security find-generic-password` non vede il Portachiavi di Vlad. `test -r` su `~<utente>/.atomic/agent/auth.json` fallisce. Nessun `*_TOKEN` nell'ambiente. Il push in un repo fuori dalla lista viene rifiutato da GitHub |
| 2 | `service.ts` intake e filtro in codice, piu' il poll di `github.ts` in sola lettura. Policy `observe` | Sul repo di prova i commenti compaiono in `harness recall`, una modifica crea un trigger nuovo, i commenti del bot vengono filtrati, un riavvio rilegge senza duplicati |
| 3 | Server MCP `harness` (`next`, `decide`, `reply`, `recall`), `router.ts` (`claude -p --resume`, Opus, permessi che negano tutto il resto), outbox, `github.send`, `harness ask`; la voce WOULD in `harness` | Una menzione produce un solo turno del router e WOULD. In `auto` la conferma di presa in carico compare una volta sola, anche con `kill -9` fra l'intento e l'invio. **Costo e durata di un turno del router** misurati; un tentativo di Bash del router viene negato |
| 3b | Rotazione della sessione del router: soglia di costo per sveglia, `next` con la tabella dei ticket aperti e le ultime decisioni | Dopo una rotazione il router risponde correttamente su un ticket aperto prima. Il costo per sveglia torna vicino a quello di una sessione nuova |
| 4 | `engine.ts` corretto: store delle sessioni su SQLite, `journal`, config del workflow su file, guard tramite `DefaultResourceLoader`, pstack dai percorsi del loader. `ticket.workflow.ts` solo con la fase `work`, worktree in `~/.harness/worktrees` | Un ticket accettato produce commit nel worktree. Nel registro ci sono `run.bound`, `run.progress` e `run.ended`. Nessun push. Nella trascrizione della fase c'e' il mandato di poteto-mode. **Costo reale del ticket** letto dalle statistiche del run (serve per D1) |
| 5 | Gate: `humanInput`, `GateId = hash(run, stage, testo)`, risposta automatica alla domanda di continuazione, normalizzazione della risposta su un'etichetta, notifica macOS | Un brief che forza una domanda: compare nell'issue, la risposta in un commento la risolve. Dopo `kill -9` e ripresa la stessa domanda ritrova la risposta. Un `git push` del worker viene bloccato dal guard con il motivo |
| 6 | Passo `verify`: `claude -p` nuovo (Opus) nel worktree, senza permessi di modifica, `publish` (branch creato dalla HEAD staccata, token del bot), `independentVerdict`, `verdictStillValid`, pulizia del worktree alla chiusura | PR aperta una volta sola, con il marcatore. Un `kill` durante `publish` non apre una seconda PR. Un cambio rotto da' `verifier-failed` e il tentativo 2. Un commit dopo il verdetto blocca `publish`. Il worktree sparisce alla chiusura |
| 7 | Follow-up: pompa `follow` dentro la fase (`StageContext.steer`), `delivered`, tentativo successivo che riprende la sessione | Un commento di review durante il run arriva al worker senza turni del router. Dopo la fine, un commento avvia il tentativo n+1 con il contesto del tentativo n |
| 8 | Budget su workflow figlio, `classify` (figlio `blocked`, radice `budget_exceeded`), `recover` all'avvio, plist di launchd come utente `harness` | Un run con `maxCost` di 0,50 $ finisce per budget, il gate compare, e "si'" avvia il tentativo successivo con 1 $. `kickstart -k` a meta' run e un `bootout/bootstrap` pulito riprendono il run dopo il lease |
| 9 | `watchdog.ts` e il suo plist | `kill -STOP` del daemon: riavviato entro 2 controlli. Un worker fermo in loop viene giudicato `stuck`, fermato e messo nella lista dell'attenzione |
| 10 | 2-3 worker concorrenti, compattazione del router, `recall` | Tre ticket in parallelo senza mai superare il limite di slot. Dopo una compattazione forzata il router ritrova un ticket vecchio seguendo i riferimenti con `recall` |
| 11 | Una settimana in observe su un repo vero (da scegliere con Vlad; il repo di un altro progetto era solo un esempio), poi `auto` | L'accordo fra `harness` e il giudizio di Vlad viene contato a mano |
| 12 | Opzionali: ticket speculativi `silent`, pagina locale dell'attenzione | Un ticket silenzioso che fallisce lascia zero commenti. La pagina mostra la stessa lista di `harness` |

L'ordine conta. Le unita' 1, 2 e 3 sono in sola lettura o scrivono solo commenti, quindi possono
girare con l'utente di Vlad sul repo di prova. Dall'unita' 4 in poi un worker esegue codice: il piano
originale chiedeva la S prima della 4. Il 02/11 Vlad l'ha rimandata. Le unita' 4-10 restano sul repo
di prova con l'utente di Vlad, e la S va chiusa prima dell'unita' 11.
