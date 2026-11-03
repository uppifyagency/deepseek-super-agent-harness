# Super-Agent-Harness MVP: progetto

Prodotto da `/pstack:architect` il 02/11/2026, seconda iterazione. Sostituisce come piano di
lavoro `../rationale.md`, che resta come riferimento per il registro degli eventi e i tipi di base.

- Tipi in `src/`: 8 file su 9 compilano con `tsc --strict`. `ticket.workflow.ts` resta escluso
  finche' Atomic non e' installato.
- Uso dal lato di Vlad: `usage.md`.
- Piano di costruzione: `build-plan.md`.
- I tre candidati sono in `candidati/`, il grounding in `../grounding/`.

## Problema

Un harness personale sempre acceso su un Mac, per i repo GitHub di Vlad. Ascolta, decide se
lavorare, fa lavorare worker isolati con pstack, fa verificare il risultato da chi non l'ha
scritto, apre la PR e risponde nell'issue. Le parti sono:

- **Atomic 0.9.63 come motore vero**, scelta di Vlad;
- **pstack come metodo**, caricato in Atomic come pacchetto Pi;
- **lo strato servizio di dsh**, il piano iniziale: fonti, Eval, Mandate, observe, coda di effetti,
  pannello;
- **le idee dell'articolo DeepSeek**.

Vincoli emersi dal grounding (`ground-atomic-host.md`, `ground-pstack-on-atomic.md`):
- gli avvisi di fine run svegliano la sessione che li possiede ma non portano gli output;
- i run in `awaiting_input` non svegliano nessuno;
- la ripresa automatica salta i run dentro il lease di circa 120 s e quelli chiusi in modo pulito;
- restringere i tool di una sessione restringe anche quelli delle sue fasi;
- Atomic non ha una fonte GitHub, un daemon ne' un watchdog;
- pstack in Atomic richiede `PI_CODING_AGENT_DIR`, `pi ask tool: off` e una fase di verifica separata.

## Uso

Vedi `usage.md`. Vlad scrive su GitHub, guarda `harness` (la lista di cio' che richiede lui, vuota
quando va tutto bene), risponde con `harness answer` e parla al router con `harness ask`. In codice
i chiamanti sono quattro: il poller GitHub, la sessione router, il motore Atomic e i comandi umani.

## Forma

**Un processo tuo (launchd) possiede il servizio, Atomic possiede l'esecuzione.** Il processo
tiene il registro degli eventi con id dal contenuto (ripreso dal primo progetto), il poller e il
filtro in codice, la outbox, la lista dell'attenzione e il ciclo di vita dei run. Atomic, incorporato
via `createAgentSession`, tiene le fasi, i checkpoint di replay, i budget e le domande in sospeso.
L'unica chiave condivisa e' `RunKey <-> AtomicRunId`, scritta una volta come `run.bound`.

**Due sessioni con compiti opposti** (decisione portante; il router e' passato a Claude Code il 02/11,
vedi Ruoli e modelli):
- la **sessione motore** possiede tutti i run e non chiama mai il modello. I run partono con lo
  slash command `/workflow`, che non fa chiamate al provider. Avvisi e heartbeat sono spenti, e il
  processo osserva i run con `observe` e `waitForSettled`;
- la **sessione router** e' l'unico LLM che il processo interroga: una sessione Claude Code
  ripresa a ogni gruppo, con i soli tool MCP `next`, `decide`, `reply` e `recall`. Non possiede run, e la sveglia il processo con un gruppo di trigger
  (`RouterBatch`). "Il router non esegue" diventa un limite di capacita', e restringere i suoi
  tool non tocca i worker.

**Una sola via di ripresa.** Con `resumeInFlight: never`, `engine.recover` gira dopo il lease per
crash, riavvio pulito e intervento del watchdog. `start` e' idempotente per `RunKey`.

**Le domande restano dentro Atomic.** Il worker chiede con `ask_user_question` di Atomic (quello di
pstack e' spento). Il guard trasforma le azioni irreversibili in una conferma. Entrambe arrivano al
processo tramite `humanInput`. Il run resta `awaiting_input` nel journal di Atomic, quindi la domanda
sopravvive ai riavvii, e `GateId` dipende dal contenuto, cosi' una domanda ripetuta ritrova la
risposta. Fa eccezione il budget: chiude il run, e se Vlad dice si' parte un tentativo nuovo con il
budget alzato che riprende la sessione del worker (`forkFromSessionId`).

**Follow-up instradati dal codice e consegnati senza turni del router.** Un commento umano su un
thread iscritto va al suo ticket senza passare dall'LLM. Se il run e' vivo, la fase `work` lo inietta
con `StageContext.steer`. Se non c'e' un run vivo, parte il tentativo successivo, che riprende la
sessione precedente. Il router vede il commento come riga `seen`, che non lo sveglia.

**Credenziali: un utente macOS dedicato e un account GitHub bot** (corretto dopo l'E2E del 02/11,
vedi `e2e/method/REPORT.md` M3). Le fasi di Atomic girano nello stesso processo del daemon, quindi
con lo stesso utente: togliere le variabili d'ambiente non basta. Un worker con l'utente di Vlad
legge il suo Portachiavi senza conferma, legge `~/.atomic/agent/auth.json` ed eredita il PAT GitHub
della shell da cui parte. Il 02/11 il PAT non era nell'ambiente di launchd (`launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN`
vuoto, misurato). Per questo:
- il daemon gira come utente macOS `harness`, con una home, un Portachiavi e un login Atomic propri;
- su GitHub agisce come un account bot, con un token fine-grained limitato ai repo in lista;
- i cloni su cui lavora sono suoi, non le cartelle di lavoro di Vlad.

Se un worker sfugge al guard, al massimo usa i permessi del bot su quei repo. Il guard
(`tool_call`, caricato con `DefaultResourceLoader`) resta la prima linea contro gli incidenti.
`publish` resta l'unico passo che usa il token del bot.

**Fatto vuol dire verificato.** La fase `verify` parte con contesto nuovo e senza tool di modifica,
e restituisce un verdetto strutturato. `independentVerdict` rifiuta il verdetto della sessione che ha
scritto il codice, e `verdictStillValid` ricontrolla sha e patch-id prima del push.

**Ruoli e modelli** (decisi da Vlad il 02/11, `ModelRoles` in `service.ts`):
- **router:** una sessione Claude Code dedicata con Opus, sul piano di Vlad. Il daemon la riprende a
  ogni gruppo di trigger con `claude -p --resume <id>`, cosi' la memoria della conversazione resta e
  gira sotto launchd senza un terminale aperto. Raggiunge l'harness solo con il server MCP `harness`
  (`next`, `decide`, `reply`, `recall`), e i permessi negano tutto il resto, bash compreso. Non e'
  la sessione in cui si costruisce l'harness;
- **worker:** una fase Atomic con `openai-codex/gpt-6.1-sol:high`, sul login Codex;
- **verificatore:** un `claude -p` nuovo a ogni verifica, Opus, nel worktree, senza permessi di
  modifica, con la skill di verifica di pstack. E' un passo dell'host (`ctx.tool`), non una fase Atomic.

Chi scrive il codice (Sol) e chi lo verifica (Opus) sono di famiglie diverse, quindi la regola di
indipendenza di pstack e' rispettata, e il verdetto lo registra con `sameFamily: false`. Atomic non
ha piu' bisogno del login Anthropic: Opus gira solo in Claude Code.

**Mappa dei moduli.**

| File | Possiede | Importa Atomic |
|---|---|---|
| `domain.ts` | l'unico elenco dei fatti, gli id, i corpi | no |
| `log.ts` | SQLite, `transact`, `idOf`, spill | no |
| `service.ts` | viste, decisori, `Harness`, `EngineHost`, `RouterPort` | no |
| `github.ts` | parsing di `gh`, cursore, invio idempotente | no |
| `engine.ts` | sessione motore, adattatore delle domande, guard, `classify`, bridge | si' |
| `ticket.workflow.ts` | il workflow: spec, work, verify, publish | si' |
| `router.ts` | sessione router e i suoi tre tool | si' |
| `daemon.ts` | composizione, cicli, CLI | no |
| `watchdog.ts` | riavvio se morto, giudizio sui progressi in due stadi | no (lancia `atomic -p`) |

## Decisione di sintesi

Tre runner `opus` a effort medium, uno per direzione:
1. l'harness come pacchetto Atomic;
2. un processo che incorpora Atomic;
3. nessun router sempre acceso, tutto e' un run.

Giudice incrociato saltato: l'override assegna solo `opus` e l'arena vuole un'altra famiglia.

**Base: candidato 2.** E' l'unico che sfrutta tutto cio' che Atomic offre (run posseduti da una
sessione, domande durevoli, budget per tentativo, steer) e allo stesso tempo tiene il router come
limite reale, separato dalla proprieta' dei run.

**Convergenze** (i tre candidati, partiti da direzioni diverse, concordano):
- archivio di fatti append-only con id dal contenuto, e journal di Atomic privato;
- filtro in codice e poi giudizio LLM su un gruppo di trigger;
- follow-up consegnati con `steer` senza turni del router (candidati 2 e 3; il 1 con l'auto-steer
  dell'estensione);
- verifica in una fase nuova senza tool di modifica;
- `publish` come passo dell'host con token dal Portachiavi;
- worker senza credenziali e guard come seconda linea;
- launchd e un watchdog separato;
- una settimana di observe e un repo di prova;
- l'harness non fa mai merge.

**Innesti dal candidato 1 (pacchetto Atomic):**
- `verdictStillValid` ricontrollato a `publish`;
- compattazione del router che sostituisce la storia con la tabella dei ticket aperti (gia' presente
  anche nel 2);
- prova di una settimana in observe su un repo reale, con il confronto contato a mano.

**Innesti dal candidato 3 (tutto run):**
- `harness ask`: Vlad parla al router dal terminale, come trigger su `system:operator`;
- notifica macOS quando si apre un gate;
- piano B gia' pronto se la prova iniziale fallisce: domande come fine del run (il tentativo n+1
  riprende la sessione) al posto di `humanInput`, bridge su socket unix al posto di `globalThis`;
- test delle credenziali che include la lettura di `~/.atomic/agent/auth.json`.

**Scartati:**
- **Il pacchetto Atomic con la sessione principale come router (candidato 1).** Il router
  possiederebbe i run, quindi ogni avviso di fine run costerebbe un turno LLM. Il poller vivrebbe
  dentro la vita di una sessione. Il passaggio di consegne `attach` fra daemon e TUI e' fragile.
- **Il router senza memoria (candidato 3).** Per una persona sola regge, ma perde la conversazione
  con il router e il contesto del worker a ogni domanda, e Atomic diventa un esecutore di run
  isolati.
- **Pagina web del pannello.** Resta un'unita' opzionale in coda. Nell'MVP il pannello e' la lista
  `harness`, piu' le notifiche.

## Compromessi accettati

- Accettiamo due archivi (registro e journal di Atomic) in cambio di usare la durabilita' di Atomic
  dove serve. Possono divergere solo sulla fine di un run, e `classify` piu' `recover` li riallineano.
- Accettiamo un bridge su `globalThis` (o, se fallisce, un socket) in cambio di follow-up dal vivo
  senza turni LLM.
- Accettiamo un workflow a due livelli (radice e tentativo) solo perche' `/workflow` non accetta un
  budget.
- Accettiamo che un gate tenga aperti un run e un worktree finche' Vlad non risponde.
- Accettiamo che Opus, usato per router e verificatore, in Atomic si paghi a token come uso extra
  (providers.md:143), in cambio di una verifica di un'altra famiglia e di un router forte. Sol lavora
  sull'abbonamento ChatGPT.
- Accettiamo di creare, gia' nell'MVP, un utente macOS e un account GitHub bot in piu', in cambio
  di un confine vero. L'E2E ha mostrato che con l'utente di Vlad il worker legge Portachiavi, PAT e
  `auth.json`. Un worker che sfugge puo' comunque usare il login del modello dell'utente `harness`
  e i permessi del bot sui repo in lista.
- Accettiamo la fatturazione a token del login Pro/Max dentro Atomic, secondo la documentazione di
  Atomic, ancora da verificare.

## Riconciliazione durante l'implementazione

### E2E del 02/11/2026 contro Atomic 0.9.63

Fonte: `e2e/engine/REPORT.md` e `e2e/method/REPORT.md`. Le prove hanno usato il modello
`openai-codex/gpt-5.6-luna-fast`, perche' Anthropic non era loggato: hanno verificato la meccanica,
non la qualita'.

**La forma regge.** Funzionano, verificati sul software reale:
- avvio di un run senza turni del modello;
- domande che arrivano a `humanInput` con id del run e della fase;
- ponte su `globalThis`;
- `steer` dall'interno della fase;
- ripresa dopo `kill -9`, senza ripetere i passi finiti e con la domanda riproposta;
- router con soli tre tool e worker con tutti i tool;
- forma esatta dello stop per budget.

Il piano B non serve.

**Deviazioni accettate (fonte: E2E):**

| Era | Diventa | Perche' |
|---|---|---|
| `SessionManager.inMemory`, impostazioni in memoria | store delle sessioni su SQLite, `journal:{path}`, impostazioni in `<home>/.atomic/extensions/workflow/config.json`, heartbeat a 0 nella definizione | con le sessioni in memoria la ripresa fallisce (`WORKFLOW_RUN_OWNED_ELSEWHERE`) |
| idempotenza di `start` con `listRuns` | mappa `RunKey -> AtomicRunId` nel nostro registro, poi `getRun(uuid)`; verificare che il run sia nato | `listRuns` non ha `inputs`, e da un processo nuovo restituisce `[]`. Un workflow rotto fallisce in silenzio |
| `GateId` da `requestId` | `GateId = hash(run, stage, testo)`; la domanda di Atomic "pronto per la fase successiva?" ha risposta automatica | dopo la ripresa il `requestId` cambia; la domanda di continuazione la pone Atomic stesso |
| risposte libere ai gate | la risposta deve coincidere con un'etichetta delle opzioni; il router la normalizza | altrimenti la fase resta in attesa |
| router con `noTools: 'all'` | `tools: ['decide','reply','recall']` piu' `customTools` | `noTools: 'all'` toglie anche i tool personalizzati |
| guard in `extensionFactories` | guard caricato con `DefaultResourceLoader` | `extensionFactories` viene ignorato in silenzio: il push in una fase e' passato |
| pstack con `atomic install -l` | pstack caricato con i percorsi del loader (`--extension`/`--skill`), `ATOMIC_CODING_AGENT_DIR=~/.atomic/agent`, `PI_CODING_AGENT_DIR` separato | con l'installazione locale, una fase in un worktree non riceve il mandato |
| worktree in `.atomic/worktrees/<ticket>` | worktree in `~/.harness/worktrees/<ticket>`, fuori dal repo; `publish` crea il branch dalla HEAD staccata; il daemon li rimuove alla chiusura | Atomic rifiuta un worktree dentro il checkout e non lo pulisce mai |
| `thinking: 'medium'` | effort come suffisso del modello, per esempio `...:medium` | `thinking` come campo non e' provato; la documentazione usa il suffisso |
| credenziali tolte dall'ambiente | utente macOS dedicato e account bot (vedi Forma) | M3 fallita: Portachiavi, `auth.json` e PAT erano leggibili |
| `ctx.tool` restituisce `{ok, value}` | `ctx.tool` restituisce il valore grezzo | osservato |

**Confermato cosi' com'era:** follow-up consegnati dall'interno della fase (lo `steer` dall'host
richiede una pausa che interrompe il turno, e senza pausa il messaggio si perde); budget su un
workflow figlio, che torna `blocked` senza far fallire il padre.

**Deviazione nell'unita' 1 (accettata, fonte: il test che l'ha trovata):** un processo che apre il
registro con meno viste, come il watchdog che non ne ha nessuna, scrive eventi che le viste del daemon
non vedono. Ora ogni vista registra fino a quale seq e' aggiornata (`view_meta.up_to`). Prima di ogni
lettura e all'inizio di ogni transazione recupera gli eventi che le mancano. Il contratto non cambia:
`transact` resta l'unica via di scrittura e le viste restano cache ricostruibili.

**Deviazione del 02/11 (fonte: decisione di Vlad): router e verificatore su Claude Code.**
- Il router passa da sessione Atomic a sessione Claude Code ripresa (`router.ts`).
- Il verificatore passa da fase Atomic a `claude -p` nuovo dentro `ctx.tool('verify')`.
- `ModelRoles` diventa tipato per runtime.

Il contratto del router (`RouterPort`) non cambia: cambia solo chi lo usa.

**Deviazione del 02/11 (fonte: decisione di Vlad): utente macOS `harness` rimandato.**
- Le unita' 4-10 girano con l'utente di Vlad, solo su `harness-sandbox` (privato, scrive solo Vlad,
  `allowedActors` = `uppifyagency`), con il guard caricato e senza push del worker.
- Rischio accettato: un errore del modello agisce con i permessi di Vlad (Portachiavi, PAT, file).
  L'iniezione da testo di terzi e' esclusa finche' il repo e' privato e il filtro passa solo Vlad.
- Account bot: `lunadelera-ops`. Sul repo di prova resta limitato dal ruolo Write.
- La S torna obbligatoria prima dell'unita' 11 o di qualunque repo reale.

**Deviazioni dell'unita' 4 (fonte: `e2e/unit4/REPORT.md`, 02/11):**

| Era (schizzo) | Diventa | Perche' |
|---|---|---|
| `gitWorktreeDir` nella fase | l'host crea il worktree (`workspace.ts`: clone in `<home>/repos`, `git worktree add --detach` in `<home>/worktrees/<ticket>-a<n>`), la fase lavora con `cwd` | Atomic crea un worktree solo se il workflow parte dentro il repo sorgente; la sessione motore parte in `<home>` (api-reference.md:742) |
| ponte `spec`, `follow`, `delivered` | ponte `prepare`, `inspect`; `follow` arriva con l'unita' 7 | la fase `work` da sola non riceve follow-up |
| `listRuns` / `graph.nodes` | `getRun`: fasi in `stages[]`, output della radice in `result.<nome>`, `durationMs` | osservato sul run reale |
| `Outcome.done` | in piu' `Outcome.worked` (lavoro committato, non verificato) | l'unita' 4 non ha verifica; l'unita' 6 lo sostituisce con `done` |
| domande del worker -> gate | l'unita' 4 risponde da sola alla domanda di continuazione e rifiuta le altre | i gate sono l'unita' 5 |
| clone libero | una coda per clone in `workspace.ts` | due run insieme si scontravano sul clone |
| pstack: ruoli dal default | foglio di pstack del worker in `<home>/pi-agent` con `pi ask tool: off`; il brief vieta i subagenti | dentro il daemon `process.argv[1]` e' la CLI dell'harness, quindi i figli di pstack lancerebbero l'harness (dedotto dal grounding, non provato) |

Run e rapporti del motore stanno in `runs.ts` (puro); `engine.ts` resta l'unico file che importa Atomic,
caricato a runtime dall'installazione globale accanto al Node di nvm.

**Deviazioni dell'unita' 5 (fonte: `e2e/unit5/REPORT.md`, 02/11):**
- Un gate per domanda (un questionario Atomic ne ha fino a 4); `GateId = hash(run, stage, indice, testo, opzioni)`.
- La risposta torna come etichetta se coincide con un'opzione, altrimenti come testo libero (`kind: 'custom'`
  di Atomic): il router normalizza, ma una risposta libera non blocca la fase.
- Il router ha un quinto tool, `answer`. Un commento su un thread con un gate gia' chiesto diventa una
  risposta da leggere; se non risponde, il router chiede di nuovo e le risposte pendenti si azzerano.
- `about` di una domanda e' l'id del `gate.opened`, non il `GateId` (che non e' un evento).
- `confirm` non ha chiamanti: il guard blocca invece di chiedere. Il gate `irreversible` resta da fare.
- La ripresa di un run legato da un processo morto (`engine.resume`, riprova ogni 15 s finche' il lease
  scade) e' anticipata dall'unita' 8, perche' la prova dell'unita' 5 la richiede.

**Deviazioni dell'unita' 6 (fonte: `e2e/unit6/REPORT.md`, 02/11):**
- `Outcome.worked` tolto: lo sostituisce `done` (con PR, url, verdetto). `failed` porta lo `sha`.
- Il verificatore gira con cwd nella home dell'harness e `--add-dir` sul worktree: le impostazioni di
  progetto del repo verificato (un `.claude/` con hook) non vengono caricate. Ha Bash per eseguire i test;
  la sola lettura e' controllata dopo (stesso HEAD, worktree pulito), altrimenti il verdetto e' scartato.
- Livello di verdetto in piu': `inspected` (documentazione, niente da eseguire).
- Una PR per ticket (branch `harness/<ticket>`, marcatore `pr:<ticket>`): il tentativo 2 continua i commit
  del primo (`startFrom`) e riprende la sessione del worker (`forkFrom`); al massimo `maxAttempts` (2).
- Il push isola git dalla config globale e di sistema di Vlad (helper di credenziali con il suo token).
- Il router riporta gli esiti finali (`results` in `next`); finale = done, budget, o failed senza altri tentativi.

**Deviazioni dell'unita' 7 (fonte: `e2e/unit7/REPORT.md`, 02/11):**
- Il ponte non ha un iteratore `follow`: un ciclo ogni 3 s dentro la fase legge `pendingInputs` e fa `steer`.
- Pendente = `input.routed` senza `input.delivered` e non elencato in `spec.inputs` di un run. Un follow-up
  che arriva fuori dalla fase `work` diventa il brief del tentativo successivo.
- Un commento su un thread con una domanda gia' chiesta e' la risposta (gate), non un follow-up.
- Alla fine di un run `done` il thread della PR viene iscritto al ticket.
- Il verificatore giudica sul brief piu' tutti i follow-up consegnati (il piu' recente vince).
- Il fork della sessione del worker richiede `context: 'fork'` oltre a `forkFromSessionId`.
- I tentativi per follow-up contano nel numero del tentativo: un fallimento ritentabile oltre
  `maxAttempts` e' finale anche se i tentativi precedenti erano follow-up riusciti (debito noto).

**Deviazioni dell'unita' 8, parte budget (fonte: `e2e/unit8/REPORT.md`, 02/11):**
- La domanda di budget e' un gate `budget` aperto dal daemon al `run.ended` (non da Atomic), con opzioni
  Sì/No e `raise`; passa dal router nell'issue come le domande del worker, piu' notifica e attenzione.
- Il budget alzato e' il massimo fra 2 volte il tetto e 2 volte la spesa: Atomic ferma fra i passi,
  quindi la spesa supera sempre il tetto di una fase intera.
- Un run fermato per budget non e' finale: il router non lo riporta come esito; con "No" il ticket resta fermo.
- Fermata per budget: l'host registra lo sha del worktree e la sessione della fase `work`, che il tentativo successivo riprende.

**Deviazioni dell'unita' 8, parte launchd (A1; fonte: `e2e/a1/REPORT.md`, 02/11):**
- Il daemon gira come l'utente macOS di Vlad e non come l'utente macOS `harness`: la S e' rimandata (Vlad, 02/11).
  Il plist sta in `~/Library/LaunchAgents` di Vlad, nel dominio `gui/501`. Con la S si sposta nel dominio
  di `harness`, prima dell'unita' 11.
- Ambiente: `ProgramArguments` passa da `/usr/bin/env -i` con un elenco chiuso di variabili, lo stesso di
  `EnvironmentVariables`. Un plist puo' aggiungere variabili, non toglierle, e cosi' un PAT messo con
  `launchctl setenv` non arriva al daemon ne' ai worker. L'ambiente globale di launchd non si tocca (D3 di Vlad).
- Lock: non piu' `O_EXCL` sul file con il pid, come diceva il piano. Riprendere il lock di un pid morto
  con "leggi, cancella, `link`" non e' atomico: con 6 processi in gara due o tre lo prendevano insieme in
  11 prove su 30 (misurato, `e2e/a1/logs/fix2/lock-stress-prima-6.txt`). Ora il lock e' una transazione
  SQLite `BEGIN EXCLUSIVE` su `run.lock.db`, tenuta per tutta la vita di `run`. E' un lock `fcntl` del
  kernel, che lo toglie quando il processo muore, anche con SIGKILL: non esiste un lock vecchio da
  riprendere, e quindi nemmeno la gara. `run.lock` resta, solo per il pid nel messaggio `already running`.
  SQLite aspetta fino a 1 s: senza attesa sei processi in gara su un lock libero ricevevano tutti BUSY.
- `install` e `uninstall` aspettano che launchd dimentichi l'etichetta dopo il `bootout`: un `bootstrap`
  subito dopo fallisce, e lo stato stampato subito dopo era ancora quello vecchio.
- Dopo `SIGTERM` il run vivo riprende in pochi secondi, senza il lease: `engine.dispose()` libera il run
  in Atomic. Il lease di circa 120 s pesa solo dopo un `kill -9`.
- `ExitTimeOut` 10 s nel plist (launchd ne usa 5 se manca). `engine.dispose()` ha preso da 18 a 58 ms, e
  al massimo 1,5 s quando lo stadio `verify` non ha risposto alla cancellazione.
- Un run interrotto dal nostro stop non consuma mai un tentativo (giro 3, `e2e/a1/REPORT.md`). Due cause,
  una sola regola. Dopo lo stadio `work`, Atomic 0.9.63 rigioca uno stadio con schema restituendo il testo
  del checkpoint (`executor-stage-replay.ts:87-93`), non l'oggetto: il workflow ora lo legge con
  `JSON.parse`. Prima del primo checkpoint Atomic risponde `WORKFLOW_RUN_NOT_RESUMABLE`, che e' definitivo:
  non si riprova piu' per 5 minuti. Si avvia di nuovo lo stesso tentativo, con un run Atomic nuovo e un
  secondo `run.bound` nel registro. Scelto questo invece di un esito "fermato" che non conta: senza
  checkpoint non c'e' niente da perdere, il piano dei tentativi resta com'e', e un esito in piu' avrebbe
  toccato `planRuns`, il router e i risultati. Si aspetta solo `WORKFLOW_RUN_OWNED_ELSEWHERE`, il lease.
- Lo stop ferma il giro: dopo SIGTERM nessun passo del giro parte piu' (`daemonLoop`), e il motore non
  avvia ne' riprende run e non segna come falliti i run che perde chiudendo la propria sessione.
- `daemonJob` scrive nel plist una `HARNESS_HOME` assoluta: il job parte nella `WorkingDirectory` `$HOME`.
- `ProcessType` `Standard`, non `Background`. A riposo la CPU e' la stessa o meno (0,33 s contro 0,42-0,43 s su
  300 s), all'avvio 2,1 s contro 8,9-9,3 s nel primo minuto e il primo battito a 4,2 s invece di 12,5 s
  (misurato, `e2e/a1/REPORT.md`). Un daemon che deve tornare subito dopo un crash non va rallentato.

**Deviazioni dell'unita' 12, ticket silenziosi (A3; fonte: `e2e/a3/REPORT.md`, 02/11):**
- Nuovo fatto `ticket.promoted { via: 'handle' | 'delivered' }` in `domain.ts`, che il piano non elencava.
  La visibilita' di un ticket cambia una volta sola, da silenziosa a visibile. Vive solo in `ticketsView`,
  che ora tiene anche i ticket chiusi. `RunSpec.visibility` e' cancellato: congelato per tentativo, sbagliava
  dopo una promozione a meta' run. `ticket.opened.visibility` resta il valore di nascita.
- La promozione con `/harness` avviene in codice, all'ingresso del messaggio, senza turno del router. La
  conferma e' un testo fisso scritto dal daemon. Anche il commento di consegna e' del daemon, non del router.
- Un ticket silenzioso ha un solo tentativo: ogni fine diversa da una PR (FAIL, budget, domanda, errore,
  blocked, stop) scrive `ticket.closed { discarded, reason }`. Il piano non lo diceva.
- Una domanda del worker in un ticket silenzioso scarta il ticket. Il motore risponde con l'ordine di fermarsi
  (una `select` riceve un annullamento, non la prima opzione). Al giro successivo il daemon chiama
  `engine.stop`: `session.workflows.quit()` mette il run in pausa in Atomic 0.9.63 (docs
  `workflows/operations.md`), e la fine `failed/stopped` la scrive l'harness. Un run di un ticket chiuso non
  e' piu' un run vivo, quindi un daemon riavviato non lo riprende. Con A2 `engine.stop` e' lo stesso.
- Un commento nuovo su un'issue vecchia, scritto dopo l'accensione, e' un candidato come gli altri: conta la
  data del messaggio, non quella dell'issue.
- Su un repo con `speculative` il router risponde in un'issue solo all'ultima chiamata del thread. Un eval
  speculativo, aperto o deciso, toglie la parola finche' non arriva una chiamata nuova.
- Il tetto `maxPerDay` e' una finestra mobile di 24 ore sui timestamp del registro, non un giorno di calendario.
- Su un repo con `speculative` il router non puo' accettare in modo visibile un messaggio che non chiama
  l'harness, e non puo' rispondere in un'issue dove nessuno l'ha chiamato (controllo in `reply()`).
- `candidateMatch` (regex sul testo) restringe i candidati di un repo. Serve alle lane, che condividono il
  sandbox con altri agenti, ed e' anche un filtro utile per Vlad (per esempio `bug|errore`).
- `classify` in `engine.ts`: un worker che chiude `blocked` lascia anche il figlio Atomic `blocked`, come
  un budget esaurito. Prima l'harness lo leggeva come budget e apriva la domanda "Continuo?". Difetto di
  trunk trovato dalla lane 2, corretto con un test.
- Atomic controlla il budget fra le fasi: con un budget silenzioso di 0,01 $ il run si e' fermato a 0,195 $
  (misurato, lane 8). Il debito del budget dentro una fase resta.

**Deviazioni dell'unita' 9, il watchdog (A2; fonte: `e2e/a2/REPORT.md`, 02/11):**
- Il battito ha un suo timer e non si scrive piu' dopo ogni giro: un turno del router dura fino a 10 minuti,
  e un battito dopo il giro sembrava un daemon morto. "Piu' di 2 giri" del piano vuol dire piu' di 2 battiti
  (2 x `--every`). Per un giro che non finisce mai c'e' `busySince`, con il limite di 15 minuti. Il battito
  parte appena il processo ha il lock, prima di aprire Atomic, che il 02/11 si e' fermato 2 minuti in cinque
  home insieme.
- Ogni eta' (battito, giro, run fermo) conta solo il tempo da sveglio: si misura dall'ultimo fra il fatto e
  `kern.waketime`. Un Mac che si sveglia dopo una notte non fa riavviare il daemon ne' giudicare i worker.
  Il sonno vero non e' stato provato, solo la regola con i test.
- Il router giu' non e' un evento. Il piano chiede che il watchdog lo segnali nell'attenzione e che scriva
  solo `watchdog.judged`, che riguarda un run. Lo stato si ricava da `router-runs.jsonl`, scritto dal
  daemon: lo leggono sia il watchdog (`watchdog.log`) sia `harness` (`ROUTER down since ...`). Un solo
  dato, nessun tipo nuovo, e l'attenzione funziona anche a watchdog spento.
- Il giudice guarda solo lo stadio `work`: `verify` e `publish` hanno i loro timeout. Giudica solo mentre un
  daemon batte per la home, perche' un daemon morto e' un guasto dell'infrastruttura e non del worker.
- `quit` di Atomic 0.9.63 lascia il run `paused`, non `killed`, e `waitForSettled` non si risolve per un run
  in pausa. Per questo e' `engine.stop()` a chiudere il run nel registro (`failed`, `stopped`, motivo dello
  stop), non `classify`.
- Uno stop non parte mentre il run ha un gate aperto, anche se lo `stop.intended` e' gia' scritto: aspetta la
  risposta. La condizione si rilegge subito prima di ogni `quit` (modello run-stop di A6).
- `harness tick` a mano viene rifiutato quando il daemon ha il lock, e `harness ask` manda le risposte su
  GitHub solo con il lock: con due processi la stessa risposta poteva uscire due volte.
- Il verificatore non perde il verdetto per percorsi non tracciati che c'erano prima di lui (`.atomic/` di
  uno stadio ripreso, `.audit/` del worker). Un tentativo dopo uno stadio rigiocato non fa il fork da
  `durable-replay:work` e parte da capo.
- Le lane 2 e 6 hanno usato l'accettazione da script (`e2e/a2/accept.ts`) al posto del router, come il piano
  permette. Le catture del piano in PNG sono testo: GitHub e' privato, come in A1.
- I servizi delle prove sono girati da un checkout in `/tmp`. Da `~/Desktop` i processi lanciati da launchd
  si sono bloccati 9 minuti in `open()` (causa probabile il permesso TCC della Scrivania, non provata).
  L'installazione vera deve stare fuori da Scrivania, Documenti e Download.

**Integrazione di A2 su A3 e A5 (branch `integrate/a2`, 02/11; prova in `e2e/int/`):**
- Un solo `engine.stop`, quello di A2: gestisce il run che Atomic lascia `paused` e il run che nessun processo
  esegue, e il ciclo di `resume` esce se il run e' in `quitting`. Il corpo e' `stopRun` in `engine.ts`, con
  `quit` e la lettura del consumo passati come dipendenze, cosi' i test lo provano senza Atomic. La fine passa
  da `reportEnded`, che rimuove il worktree perche' `failed/stopped` non si riprova.
- Un solo `runsToStop` in `runs.ts`: i run non finiti di un ticket chiuso (A3) piu' i run vivi con uno
  `stop.intended` ancora valido (A2, regola H1: il giudizio e' ancora l'ultimo segno del run). Il giro del
  daemon (`driveRuns` in `cli.ts`, prima `startRuns`) ha un solo ciclo di stop: `intendStops()` scrive gli
  `stop.intended`, e prima di ogni `quit` rilegge `runsToStop()`. Il secondo ciclo di A3, dopo `planRuns`, e'
  cancellato.
- Il motivo nel `run.ended`: un run fermato dal watchdog porta il motivo dello stop (A2). Un run di un ticket
  chiuso tiene il motivo del motore (`ticket discarded, quit in Atomic: paused`), anche se uno stop piu'
  vecchio, superato dal run, e' nel registro (`watchdogStopOf`).
- `stuckItems` di A2 leggeva `ticketsView.open`; con A3 la vista tiene anche i ticket chiusi, quindi ora
  filtra `!closed`.
- Consumo dei run fermati. Atomic 0.9.64 riempie `modelAttempts` solo alla fine di un tentativo dello stadio:
  un `quit` dentro `work` lascia nel run il consumo 0 (checkpoint `workflow-run-usage` con `cost: 0`,
  misurato su #126). Il consumo vero e' nei messaggi della sessione dello stadio. `engine.stop` scrive
  `usage` nel `run.ended`: quello del run se Atomic lo ha, altrimenti la somma dei turni dell'assistente
  nelle sessioni degli stadi (`resolveSessionStore`, API pubblica di Atomic) da `startedAt` del run in poi,
  perche' una sessione nata da un fork contiene anche i turni del padre. Il record di un run in pausa non ha
  `createdAt` ne' `durationMs`: la durata e' `pausedAt - startedAt`.
- Messaggio del verificatore: un worktree sporco gia' prima del verificatore perde il PASS con "the worktree
  has uncommitted changes (<percorsi>)". "the verifier changed the worktree" resta solo per i percorsi che il
  verificatore ha sporcato (nota del verificatore di A2).
- Test: tutti quelli dei due lati, 103 di A3 e A5 e 77 di A2 (uno rinominato da A2), piu' 5 nuovi.
- Prova dal vivo (checkout in `/tmp/swarm-int/repo`, home `/tmp/swarm-int/m1/home`, accettazione da
  `e2e/int/decide.ts`). Issue #126: ticket silenzioso scartato con `e2e/int/discard.ts` (la stessa
  `openGate` di una domanda del worker) mentre il worker lavorava; al giro dopo `quit` e `run.ended`
  `failed/stopped` 1 ms dopo, worktree rimosso, zero commenti (`e2e/int/logs/int-scartato.txt`). Issue #127:
  il worker gira in tondo su un file che non arriva; un `watchdog.judged` `stuck`, un `stop.intended`, `quit`
  e `run.ended` con il motivo del giudice e `usage` 0,0589 $ in 4 turni, worktree rimosso
  (`e2e/int/logs/int-watchdog.txt`). Il `run.ended` di #126 non aveva `usage`: la lettura delle sessioni e'
  nata da li', e #127 gira con essa. Il filtro dall'avvio con un fork vero e' provato solo dal test.
- Dopo il verificatore dell'integrazione (02/11). `harness setup` installava solo il daemon: ora chiama
  `installService` di `launchd.ts`, la stessa funzione di `harness service install` (daemon e watchdog), e
  `harness doctor` ha una riga in piu' per il watchdog. Il watchdog gira ogni 120 s e poi esce, quindi
  doctor chiede solo che l'etichetta sia caricata (`launchctl print` con uscita 0), non un pid. Un run che
  il watchdog aveva fermato, poi andato avanti, e finito fermato per un altro motivo prendeva il motivo
  vecchio e risultava STUCK: ora il `run.ended` prende lo stop solo se vale ancora (`liveStop`, regola H1),
  e `stuckItems` legge lo stop tra le cause del `run.ended`, non l'ultimo `stop.intended` del run.
  Prova dal vivo da un clone in `/tmp`: `setup --yes` su una home di prova installa le due etichette,
  doctor le dice `ok`, `service uninstall` toglie etichette e plist (`e2e/int/logs/int-setup.txt`). Issue
  #128, visibile: il watchdog ferma il run fermo e il `run.ended` porta `usage` con `durationMs` 265041
  (`e2e/int/logs/int-stuck.txt`, seq 745). La home m1 riusata ha prima ripreso il ticket di #127, per il commento
  di chiusura del 21:50 arrivato dopo lo stop del daemon: anche quel secondo tentativo e' stato fermato
  dal watchdog. Pulizia in `e2e/int/logs/int-stuck-pulizia.txt`.
- Ultimo giro prima della v0.1.0 (02/11). Un watchdog caricato che esce con errore a ogni controllo
  risultava `ok`: ora doctor legge anche `last exit code` dalla stessa `launchctl print` del servizio e
  chiede 0 o "(never exited)". Il passo watchdog di setup chiamava `installService`, che riavviava un daemon
  sano e riportava `--every` a 60: ora installa solo il job del watchdog. `stuck-proof.sh` aspetta il
  `run.ended` del ticket sotto prova, non il primo dopo l'issue (in `int-stuck.txt` era quello di #127).

**atomic-remote** (plugin di Vlad, v0.3.1, provato nel suo changelog fino ad Atomic 0.9.13) ha il
ruolo A. Il motore resta incorporato nel daemon tramite SDK, il percorso provato nell'E2E.
atomic-remote e' il canale con cui Vlad osserva e guida Atomic dal vivo. Il router non lo usa per
avviare run, altrimenti ci sarebbero due modi di avviarli. Il 02/11 il suo bridge si e' caricato
nelle sessioni 0.9.63, ma i suoi comandi non sono stati provati su questa versione. Il ruolo B (Atomic
come processo a se', comandato dai file del bridge) resta un'alternativa per dopo l'MVP.

**atomic-remote sulla 0.9.63 (E2E del 02/11):** funziona dopo tre correzioni, sul branch
`atomic-0.9.63-compat` (commit `e9ffd55`, v0.3.2, non pubblicato):
1. un interrupt non terminava mai l'attesa;
2. le fasi dei workflow si registravano come sessioni comandabili, il che risolve anche il rischio
   qui sotto;
3. un run in attesa di risposta non veniva segnalato.

Test 120 su 120.

**Rischio di sicurezza:** il bridge e' installato globalmente (`~/.atomic/agent/extensions/`) e si
carica in ogni sessione Atomic, comprese le fasi dei worker. Chi scrive nella sua inbox comanda quel
worker. Per l'utente `harness` non va installato in modo globale.

**Effetti collaterali delle prove:**
- un run ucciso e' finito nel journal predefinito `~/.atomic/workflows/journal.sqlite`;
- il PAT GitHub e' in chiaro nel profilo della shell. Il 02/11 non era nell'ambiente di launchd
  (`launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN` vuoto, misurato).

## Domande aperte e rischi

1. **La prova iniziale (unita' 0): chiusa il 02/11, tutto PASS.** Restano le correzioni elencate
   nella riconciliazione.
2. **Modelli e costo.** Confermato da providers.md:143: "Third-party harness usage draws from extra
   usage and is billed per token, not against Claude plan limits". Opus in Atomic, quindi, si paga a
   token. Il login Codex (`gpt-6.1-sol`, scelto da Vlad in Atomic) usa invece l'abbonamento ChatGPT,
   con limiti che non abbiamo misurato. **Deciso il 02/11: Opus router e verificatore, Sol worker.**
   Resta da misurare il costo: il router Opus fa un turno per ogni gruppo di trigger, quindi la sua
   spesa cresce con il traffico dei repo. L'unita' 4 misura il costo di un ticket vero, e l'unita' 3
   quello di un turno del router.
3. **Latenza dei follow-up.** Un commento di review consegnato con `steer` arriva dopo le chiamate di
   tool in corso. Basta, o certi commenti devono fermare e ripartire?
4. **Identita' su GitHub: deciso dall'E2E, account bot.** Serve anche per il confine delle
   credenziali (vedi Forma). Da creare: l'account bot, il token fine-grained limitato ai repo e
   l'utente macOS `harness`.
5. **Verifica di un'altra famiglia: risolta** dalla scelta dei modelli del 02/11.

## Prossimo passo

Unita' 1 del `build-plan.md` (`log.ts`) e, in parallelo, l'unita' S: l'utente macOS `harness` e
l'account bot. La S richiede azioni di Vlad.
