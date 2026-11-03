# Handoff: Super-Agent-Harness (02/11/2026)

Per l'agente che riprende il lavoro. Leggi questo file per intero, poi `design/mvp/rationale.md` e
`design/mvp/build-plan.md`. Le prove e i numeri citati qui sono stati misurati il 02/11: se non li
riproduci, dillo.

## 1. Cosa stiamo costruendo

Un **super agent harness personale** per Vlad: un Mac, una persona, uso locale. Ascolta i suoi repo
GitHub, decide se c'e' lavoro, lo fa fare a worker isolati, lo fa verificare da chi non l'ha scritto,
apre la PR e risponde nell'issue. L'unica risorsa scarsa e' l'attenzione di Vlad.

Unisce tre cose (piano iniziale di Vlad):
- lo **strato servizio di dsh-superagent** (DeepSeek), portato in TypeScript: fonti, filtro, Mandate,
  observe, outbox;
- **Atomic 0.9.63** come motore di esecuzione dei worker;
- **pstack** come metodo dentro ogni worker.

L'intento di progetto viene dall'articolo DeepSeek "Exploring Super-agent Design" (letto per intero in
`riferimenti/dsh-superagent/articolo/articolo.md`).

## 2. Stato

| Unita' | Stato | Prova |
|---|---|---|
| 0, 0b: E2E del confine con Atomic, pstack, guard, credenziali | fatta | `design/mvp/e2e/engine/REPORT.md`, `e2e/method/REPORT.md` |
| 1: registro degli eventi (`harness/src/log.ts`) | fatta | test di replay, dedupe, concorrenza fra 3 processi, mutazione |
| 2: fonte GitHub, filtro in codice, observe | fatta | issue #1 su `uppifyagency/harness-sandbox` |
| 3: router su Claude Code, server MCP, risposte, `harness ask` | fatta | issue #1, #2, #3; crash fra POST e settle; `e2e/unit3/` |
| 3b: rotazione della sessione del router, lavagna in `next` | fatta | stessa risposta prima e dopo la rotazione, 0,62 -> 0,086 $ |
| **S**: account bot | fatta: `lunadelera-ops`, Write su `harness-sandbox`, token nel Portachiavi (`harness-bot-github`) | `gh api` come bot: push true, admin false |
| **S**: utente macOS `harness` | **rimandata da Vlad il 02/11**, blocca l'unita' 11 | guida in `design/mvp/guida-unita-S.md` |
| 4: motore Atomic + workflow, fase `work` con Sol | fatta, con l'utente di Vlad | `design/mvp/e2e/unit4/REPORT.md`: 2 ticket, 2 commit, 0 push, 0,12 $ a ticket |
| 5: gate, domande del worker nell'issue | fatta | `design/mvp/e2e/unit5/REPORT.md`: issue #4, kill -9 a domanda aperta, stesso gate dopo la ripresa |
| 6: verifica con Opus, PR del bot | fatta | `design/mvp/e2e/unit6/REPORT.md`: PR #6 di `lunadelera-ops`, 0,42 $ a ticket |
| 7: follow-up al worker | fatta | `design/mvp/e2e/unit7/REPORT.md`: issue #8, PR #9 con 3 tentativi, fork della sessione |
| 10: worker in parallelo, recall | fatta | `design/mvp/e2e/unit10/REPORT.md`: max 2 run vivi su 3 ticket, router ritrova un ticket con 9 recall |
| 8 (parte budget) | fatta | `design/mvp/e2e/unit8/REPORT.md`: fermata a 0,134 $ su 0,03 $, "Sì" nell'issue, tentativo 2 e PR #17 |
| 8 (launchd), 9, 11, 12 | da fare | vedi `build-plan.md`; 8 e 9 installano servizi launchd: serve il si' di Vlad |

`cd harness && npm test` deve dare **42 test su 42**, `npx tsc -p tsconfig.json` exit 0.

L'harness oggi ascolta, filtra, decide, risponde, parla con Vlad e fa lavorare Sol sui ticket in un worktree. Opus verifica e il bot apre la PR; l'harness non fa mai merge.

## 3. Dove sta cosa

```
Super-Agent-Harness/
  HANDOFF.md                      questo file
  README.md                       indice di tutto
  harness/                        IL CODICE (Node 26, TS senza build, zero dipendenze runtime)
    src/domain.ts                 unico elenco dei fatti (Kinds), id, tipi; threadKey()
    src/log.ts                    registro SQLite append-only, id dal contenuto, viste come cache
    src/config.ts                 ~/.harness/config.json (o HARNESS_HOME)
    src/github.ts                 unico file che parla con GitHub: poll, send idempotente
    src/service.ts                filtro in codice, intake, Harness (oggetto pubblico)
    src/routing.ts                eval, decide, reply, outbox, attenzione, lavagna
    src/mcp.ts                    server MCP `harness` (stdio) per il router
    src/router.ts                 driver `claude -p --resume`, rotazione
    src/cli.ts                    harness [attention] | init | poll | tick | run | ask | recall | status | policy | mcp
    test/                         node:test (log, service, routing)
  harness-home-sandbox/           la home usata per le prove sul repo di prova (log, cursore, sessione router)
  design/mvp/                     IL PROGETTO VIGENTE
    rationale.md                  forma, decisioni, deviazioni accettate (sezione Riconciliazione)
    build-plan.md                 unita' con stato e prove
    guida-unita-S.md              passi per Vlad: bot e utente macOS
    src/*.ts                      schizzo dei tipi delle unita' future (engine, workflow, router)
    e2e/                          report e script delle prove
    candidati/                    i 3 candidati dell'arena
  design/                         prima iterazione (superata dall'MVP, utile per il registro)
  design/grounding/               analisi di dsh, Atomic, pstack, Atomic come host, pstack in Atomic
  riferimenti/                    dsh (repo, deepwiki, analisi, articolo, diagrammi), pstack, atomic
  riferimenti/atomic-remote/      clone del plugin di Vlad, branch atomic-0.9.63-compat (non pubblicato)
```

## 4. Come si esegue

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"        # Node 26.13.0 (default nvm); /usr/local/bin/node e' ancora 20.19.5
cd "harness"
npm test && npx tsc -p tsconfig.json

export HARNESS_HOME="$PWD/../harness-home-sandbox"      # la home di prova; senza questa variabile e' ~/.harness (non esiste ancora)
node src/cli.ts status          # mode, contatori del filtro, attesa router, outbox
node src/cli.ts                 # cosa aspetta Vlad
node src/cli.ts tick            # poll GitHub -> router (se c'e' lavoro) -> invio risposte
node src/cli.ts ask "..."       # parlare al router
node src/cli.ts recall issue:uppifyagency/harness-sandbox#2
node src/cli.ts work            # run.intended per i ticket aperti, run in Atomic (Sol), aspetta la fine
node src/cli.ts answer <gate> <testo>   # rispondere a una domanda del worker dal terminale
node src/cli.ts policy auto --workers 2  # modo e numero di worker in parallelo
```

Nel `harness-home-sandbox` la policy e' **auto**. Il router su GitHub scrive con l'account di Vlad
(`uppifyagency`) finche' non esiste il bot.

## 5. Decisioni prese: non rimetterle in discussione senza fatti nuovi

| Decisione | Fonte |
|---|---|
| Uso locale e personale, niente cloud o multiutente | Vlad, 02/11 |
| Atomic e' il motore dei worker, non un esecutore di passi | Vlad |
| Forma: un daemon possiede il servizio (registro, poller, outbox, ciclo di vita dei run); Atomic e' incorporato via SDK e possiede l'esecuzione | arena MVP, candidato 2 |
| **Router = sessione Claude Code dedicata, Opus**, ripresa con `claude -p --resume`. Non la sessione in cui si costruisce | Vlad, 02/11 |
| **Verificatore = `claude -p` nuovo, Opus, senza permessi di modifica**, passo dell'host nel workflow | Vlad, 02/11 |
| **Worker = fase Atomic con Sol** (`openai-codex/gpt-6.1-sol:high`, login Codex) | Vlad, 02/11 |
| Atomic non ha bisogno del login Anthropic | conseguenza delle tre righe sopra |
| atomic-remote (plugin di Vlad) = canale per osservare e guidare Atomic dal vivo (ruolo A), non la via per avviare i run | Vlad, 02/11 |
| Credenziali: utente macOS `harness` + account GitHub bot (unita' S) | E2E M3 fallita |
| Utente `harness` rimandato: unita' 4-10 come Vlad, solo su `harness-sandbox`, guard, nessun push del worker; S prima dell'unita' 11 | Vlad, 02/11 |
| Bot = `lunadelera-ops` | Vlad, 02/11 |
| Chiamata dell'harness su GitHub: `/harness`, non `@harness`, finche' non c'e' il bot | evitare menzioni a sconosciuti |
| Id degli eventi dal contenuto, mai dall'ora; viste ricostruibili; `transact` unica via di scrittura | progetto |
| L'harness non fa mai merge ne' deploy | progetto |

## 6. Fatti verificati che ti risparmiano ore

**Atomic 0.9.63** (dettagli in `design/mvp/e2e/*/REPORT.md` e `design/mvp/rationale.md`):
- sessioni del motore su SQLite, non in memoria: con `SessionManager.inMemory` la ripresa fallisce;
- `/workflow <nome> runKey=...` avvia un run senza turni del modello;
- `listRuns` non ha `inputs` e da un processo nuovo restituisce `[]`: tieni tu la mappa RunKey -> run id;
- le domande arrivano a `humanInput` con id di run e fase. Atomic aggiunge una sua domanda
  "pronto per la fase successiva?". Le risposte devono coincidere con un'etichetta delle opzioni;
- `StageContext.steer` funziona dall'interno della fase; dall'host serve una pausa;
- `noTools: 'all'` toglie anche i tool personalizzati;
- il guard va caricato con `DefaultResourceLoader`: `createAgentSession({extensionFactories})` viene
  ignorato in silenzio, e un push e' passato davvero;
- pstack va caricato dai percorsi del loader, non con `atomic install -l` (nei worktree perde il
  mandato). `ATOMIC_CODING_AGENT_DIR=~/.atomic/agent`, `PI_CODING_AGENT_DIR` separato;
- worktree fuori dal repo (`~/.harness/worktrees/<ticket>`); Atomic non li pulisce mai;
- `atomic -p "/workflow ..."` esce e uccide la fase; chiudi stdin su ogni `-p`;
- budget: un figlio oltre budget torna `{status:"blocked"}`; la radice va `blocked` + `active_blocked` +
  `budget_exceeded`;
- la ripresa automatica salta i run dentro il lease di circa 120 s.

**Claude Code come router:**
- `--tools ""` toglie tutti i tool di base. Una lista di negati lasciava Artifact, CronCreate,
  RemoteTrigger, PublishPlugin e altri. Verificato dall'evento di init: il router ha solo i 4 tool MCP;
- `--bare` non va bene: richiede una API key e ignora il login del piano;
- costo per sveglia della sessione ripresa: 0,31 -> 0,62 $ in sette sveglie (equivalente API, sul piano
  consuma limiti). Da qui la rotazione a 0,45 $.

**GitHub:**
- le liste rispondono con ritardo: un'issue creata un secondo prima del poll non c'era. Il poll
  rilegge 5 minuti prima del cursore;
- l'`updated_at` di un'issue cambia a ogni commento: la versione di un elemento e' l'hash del testo.

**Macchina:**
- il PAT GitHub di Vlad e' in chiaro nel profilo della shell. Nell'ambiente di launchd non c'e'. Il 02/11
  `launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN` e' vuoto (misurato). Non e' stato toccato: aspetta la decisione di Vlad;
- il bridge di atomic-remote 0.3.1 e' installato globalmente in `~/.atomic/agent/extensions/` e si
  carica in ogni sessione Atomic. La 0.3.2 sul branch corregge il caso delle fasi;
- copia della vecchia configurazione di Atomic in `~/.atomic/backup-2026-11-02-pre-0.9.63/`.

## 7. In attesa di Vlad

1. **Unita' S, utente macOS `harness`** (rimandata il 02/11, blocca l'unita' 11): utente Standard, login
   di Atomic (Codex) e Claude Code per quell'utente, poi il token del bot passa dal Portachiavi di Vlad
   (`harness-bot-github`) a `gh` di `harness` e va cancellato da quello di Vlad. Passi in
   `design/mvp/guida-unita-S.md`; la password casuale dell'utente e' gia' nel Portachiavi
   (`harness-macos-user`). Poi rifai la prova M3 come utente `harness` (passo 5 della guida).
2. **atomic-remote 0.3.2:** pubblicare il branch `atomic-0.9.63-compat` su `uppifyagency/atomic-remote`
   o lasciarlo in locale? **Non pubblicare senza un si' esplicito.** Il clone e' in
   `riferimenti/atomic-remote/`. Dopo la pubblicazione: reinstallare plugin e bridge
   (`node scripts/install-bridge.mjs`, poi `/reload` in Atomic).
3. **PAT nel profilo della shell:** toglierlo dal profilo? Nell'ambiente di launchd il 02/11 non c'era
   (misurato). Il comando e' nella guida, passo 4.
4. **Issue #1 sul repo di prova:** il router aspetta conferma e il titolare della licenza.
5. Facoltativo: `sudo installer -pkg ~/Downloads/node-v26.13.0/node-v26.13.0.pkg -target /` per il Node
   di sistema. Non serve, se il plist di launchd punta al Node di nvm.

## 8. Prossimi passi

In lista, non urgenti (Vlad, 02/11): **T1** budget in token invece che in $, **T2** pausa della coda
quando un abbonamento raggiunge il limite. Dettagli in `design/mvp/build-plan.md`. Lavoriamo su
abbonamenti: i $ nei report sono consumo in prezzo di listino, non spesa.

1. **Unita' 8** (budget, ripresa, launchd). Fatte la 4, 5, 6, 7 e 10; la ripresa dopo un crash c'e' gia' (unita' 5). La parte budget non richiede launchd; launchd e watchdog (8, 9) richiedono il si' di Vlad. Testo storico della 4: `engine.ts` e `ticket.workflow.ts` reali, a partire da
   `design/mvp/src/` con le correzioni della Riconciliazione. Solo la fase `work`, Sol, worktree in
   `~/.harness/worktrees`, nessun push. Prova: commit nel worktree, `run.bound`/`run.progress`/`run.ended`
   nel registro, mandato di poteto-mode nella trascrizione, **costo reale di un ticket**.
   `ticket.opened` esiste gia' (unita' 3); manca `run.intended` dopo un accept.
2. Unita' 5-10 in ordine, come da `build-plan.md`. Ognuna finisce con una prova sul software reale.
3. Unita' 11: una settimana in observe su un repo vero da scegliere con Vlad (il repo di un altro progetto era solo un esempio), poi `auto`.
   Alternativa da valutare: worker su una seconda macchina (isolamento piu' forte); serve prima una prova di Node 26 e Atomic li', con un si' di Vlad.

Metodo: le unita' nuove con forma non ovvia passano da `/pstack:architect` (regola di Vlad: architect
prima del codice). Ogni deviazione dal progetto va scritta nella Riconciliazione di
`design/mvp/rationale.md`.

## 9. Convenzioni del progetto

- I testi dell'harness su GitHub sono in **italiano**. Niente carattere em dash.
- Numeri: di' sempre se sono **misurati**, **documentati** o **stime**, e cosa altro potrebbero misurare.
  Prima di consigliare un cambio, confrontalo con l'alternativa sulla metrica che decide.
- Verifica sul software reale, non su un mock. Se una prova non ha esercitato il caso (e' successo
  con il primo test del crash), dillo e rifalla.
- Azioni verso l'esterno (pubblicare, pushare, scrivere su repo non di prova) solo con un si'
  esplicito dell'operatore. Sul repo di prova puoi creare issue e commenti.

## 10. Debiti e rischi noti

- Budget: Atomic lo controlla fra i passi, non dentro una fase; una fase lunga puo' superarlo di molto. Con "No"
  il worktree del tentativo fermato resta.

- I commit delle PR del bot hanno come autore Vlad (config git di Vlad nel worker). Si chiude con l'utente
  `harness` o impostando l'autore del worker.
- I tentativi per follow-up contano verso `maxAttempts`: un fallimento dopo due follow-up e' subito finale.
- Stato del sandbox al 02/11 sera: PR #6, #9, #13, #14, #15, #17 unite da Vlad (tramite questa sessione), branch del bot cancellati,
  issue di prova #2-#5, #7, #8 chiuse; resta aperta solo la #1 (decisione sulla licenza). Home di prova
  temporanee cancellate (i log sono in `design/mvp/e2e/unit*/logs`). In `harness-home-sandbox` il registro
  contiene due `run.ended` sbagliati del primo tentativo dell'unita' 4: e' una home di prova, non riusarla per run nuovi.

- `harness ask` aspetta in primo piano un'unica sveglia del router: se il router non risponde
  all'operatore, non stampa niente.
- `harness run` e' un ciclo semplice, senza launchd (unita' 8) e senza watchdog (unita' 9).
- Il filtro tratta come `follow-up` ogni messaggio umano su un thread iscritto, anche di sconosciuti.
  Va bene finche' i repo sono privati.
- Tre scritture del log non sono ancora coperte da test end-to-end con piu' processi insieme: MCP
  (processo del router), CLI e daemon. Il registro lo regge (test di concorrenza), ma il caso reale
  non e' stato provato sotto carico.
- Il costo di una sessione router nuova "a freddo" non e' misurato: lo 0,086 $ aveva la cache calda.
