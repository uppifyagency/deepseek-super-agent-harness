# Super-Agent-Harness: forma dei tipi

Prodotto da `/pstack:architect` il 02/11/2026. Tipi in `src/` (6 file, `tsc --strict` passa,
corpi `not implemented`). Uso dal lato del chiamante in `usage.md`. I tre candidati completi
sono in `candidati/`, il grounding in `grounding/`.

## Problema

Un servizio sempre acceso che ascolta GitHub (poi IM), decide se e' autorizzato a lavorare, fa
girare il lavoro in modo durevole in un worker isolato, lo fa verificare da chi non l'ha scritto e
risponde dove la persona ha scritto. L'unica risorsa scarsa e' l'attenzione umana.

Vincoli emersi dal grounding:

- **dsh** (`grounding/ground-dsh.md`): lo stato e' sparso in piu' posti mutabili
  (`Thread.subscriptions`, `Ticket.follows`, tabella effetti, outbox), diversi id contengono un
  timestamp e quindi cambiano a ogni replay, fermare un worker non sopravvive a un crash.
- **Atomic 0.9.63** (`grounding/ground-atomic.md`): niente DBOS ne' Postgres, il journal e' SQLite.
  Non c'e' RPC per avviare un workflow o rispondere a un gate. La ripresa e' pubblica solo via
  `session.workflows.resume`. Lo stop per budget appare come `running`. I tool girano almeno una
  volta, e alla ripresa il corpo riparte dall'inizio. Le fasi usano solo l'agente di Atomic, senza
  gli hook di Claude Code.
- **pstack** (`grounding/ground-pstack.md`): "fatto" vuol dire un verdetto di chi non ha scritto
  il codice, legato allo SHA. Le pause obbligatorie sono solo testo e le deve imporre l'host.
  pstack non ha budget.
- **Articolo DeepSeek** (`../riferimenti/dsh-superagent/articolo/`): router che non esegue e
  raggruppa i trigger per turno, passaggio diretto ai worker iscritti, worker che non parlano mai
  con le persone, risultati asincroni come nuovi eventi, esecuzione speculativa, Watchdog esterno,
  credenziali usabili senza entrare nel contesto.

## Uso

Vedi `usage.md`. Ci sono quattro tipi di scrittori: le fonti, il router, l'executor e le persone
tramite il pannello. In lettura ci sono `recall`, `attention` e `router.next`. Tutti passano da
`Harness`, e nessuno vede righe, code o colonne di stato.

## Forma

**Un registro, uno scrittore** (`log.ts`). L'unica via di scrittura e'
`log.transact(decider)`: un decisore puro gira dentro `BEGIN IMMEDIATE`, i suoi eventi vengono
aggiunti e le viste aggiornate nella stessa transazione. Ogni fatto e' un `Event` su un Thread
(`events.ts`). Ogni Ticket e' un thread di lavoro proprio.

**Tutto il resto si deriva** (`fold.ts`): Ticket, subscription, stato del Run, validita' del
Mandate, effetti in sospeso e pannello. Non c'e' una tabella da tenere allineata a mano
(per single source of truth).

**Gli id dipendono solo dal contenuto.** `idOf = hash(thread, kind, autore, cause ordinate, corpo)`,
senza l'ora. Se una fonte viene riletta, se un decisore rigira dopo un crash o se un clic arriva
due volte, si ottiene un solo evento. L'id del run di Atomic e' il nostro `RunId`
(per make-operations-idempotent).

**"Salva poi fai" non ha bisogno di una coda a parte.** Un effetto e' un evento `*.intended`, ed
e' in sospeso finche' non esiste il suo esito. Per questo anche lo stop sopravvive ai crash.

**Observe ed esecuzione speculativa usano lo stesso meccanismo.**
- Observe: un accept dedotto si salva come `decided {observe, wouldAccept}` e finisce nel pannello.
- Speculativa: e' un ticket `silent`. Non manda la conferma di presa in carico e non puo' fare
  domande: se un run si ferma su una domanda, il ticket si chiude come `discarded`. I fallimenti
  non vengono annunciati. Un verdetto positivo e' la conferma, quindi la consegna avviene.
- `panel.simulate(policy)` fa ripassare i trigger salvati sotto una policy candidata, senza LLM e
  senza scrivere nulla, prima di passare a `auto`.

**I ruoli sono nei tipi, non nei prompt.** `Kinds[k].by` fissa l'autore di ogni tipo di evento:
l'executor non puo' scrivere `reply.intended`, quindi i worker non parlano con le persone.
`ReplyText` nasce solo da `composeReply`, che applica le norme del canale (IM: 100 parole, GitHub:
strutturato). Un `IndependentVerdict` nasce solo da `independentVerdict()`, che rifiuta il verdetto
dell'autore. Un esito `done` senza verdetto non si puo' costruire (per type-system-discipline).

**Ogni domanda a una persona e' un Gate, e il Gate chiude il run.** La risposta avvia il tentativo
successivo, che riprende la stessa sessione di Claude Code (`--resume`), cosi' il worker non perde
il contesto. Non usiamo `ctx.ui` di Atomic: manca l'RPC per rispondere, e le chiavi di replay
dipendono dal punto del codice in cui il workflow chiama la UI.

**Atomic sta dietro tre metodi** (`executor.ts`): `start`, `stop` e `reconcile` in entrata,
`sink.report` in uscita. `classify` e' l'unico punto che legge gli stati di Atomic. Un tentativo e'
un workflow di quattro passi: `worktree`, `work` (`claude -p` con pstack), `verify` (sessione
nuova, non l'autore) e `publish` (push e PR con le credenziali del servizio).

**Le pause obbligatorie valgono per capacita', non solo per istruzione.** Il processo del worker
non ha token di push, deploy o messaggistica, quindi puo' solo fare commit. Push e PR li fa il passo
`publish`, con credenziali che il worker non vede mai. In piu' l'hook PreToolUse trasforma i
tentativi di azioni irreversibili in un gate `irreversible`.

**Mappa dei moduli.**

| File | Possiede |
|---|---|
| `events.ts` | l'unico elenco dei tipi di evento, gli id, i corpi |
| `log.ts` | SQLite, `transact`, `idOf`, lo spill del testo lungo (privato) |
| `fold.ts` | viste e derivazioni pure |
| `decide.ts` | decisori e reazioni, puri |
| `executor.ts` | la porta verso Atomic e il suo adattatore, unico import di `@bastani/atomic` |
| `service.ts` | l'unica esportazione: `openHarness` e `Harness` (10 metodi) |

Qualunque flusso si segue in tre file: il metodo di `Harness`, il suo decisore e la vista che cambia.

## Decisione di sintesi

Tre runner `opus` a effort medium, ciascuno con una direzione strutturale assegnata: registro al
centro, Ticket come workflow di Atomic, sessioni come attori con casella di posta. Il giudice
incrociato e' stato saltato: l'arena lo vuole di un'altra famiglia di modelli, e l'override
assegna solo `opus`. La base l'ho scelta io sulla rubrica: un solo proprietario per ogni stato, id
stabili ai replay, profondita' dell'interfaccia verso il motore, autorita' nei tipi, aderenza ai
limiti reali di Atomic 0.9.63 e costo in attenzione umana.

**Base: candidato 1 (registro al centro).** E' l'unico con una sola fonte di verita' per tutto lo
stato del servizio. Ha un solo elenco dei tipi di evento, controllato in modo esaustivo, e
`simulate` per la policy.

**Convergenza.** I candidati 1 e 3, partiti da direzioni opposte, sono arrivati alle stesse scelte:
- lo stato lo tiene il servizio, non Atomic;
- i gate sono righe del servizio, non `ctx.ui`;
- il worker e' `claude -p` dentro `ctx.tool`, con un hook PreToolUse;
- gli id non contengono l'ora;
- i risultati asincroni rientrano come eventi.

Anche il candidato 2 indica `claude -p` come seconda scelta forte. E' un segnale forte.

**Innesti dal candidato 3 (attori):**
- verdetto indicizzato per (repo, sha), non per PR: un ticket speculativo si verifica prima che la
  PR esista;
- `RouterBatch.seen`: il router riceve copie in una riga, che non lo svegliano, di quello che e'
  passato direttamente ai worker, cosi' mantiene il quadro globale;
- tipi di gate distinti (`question`, `irreversible`, `budget`);
- la sessione di Claude Code viene ripresa da un tentativo all'altro, cosi' il contesto non si
  perde. Era il punto debole dichiarato del candidato 1.

**Innesti dal candidato 2 (Ticket come workflow):**
- credenziali solo nei passi del servizio (`hostSecrets`), mai nel processo del worker;
- lo stop per budget non riprende il run bloccato (la ripresa di sessione non accetta un budget): si
  apre un nuovo tentativo con il budget alzato;
- `publish` sicuro anche se rigira: push idempotente per sha, PR trovata o aperta per branch con un
  marcatore nascosto.

**Scartati:**
- **Il Ticket come run lungo di Atomic (candidato 2).** Il recupero dopo un crash dipende dal fatto
  che `session.workflows.resume` adotti un run avviato con `run()`, e questo non e' verificato.
  Inoltre tiene migliaia di run in attesa in memoria.
- **Le tabelle mutabili con caselle di posta del candidato 3.** Sostituite dalle viste sul
  registro, perche' danno una sola fonte di verita'.
- **La rivalidazione a ogni turno del candidato 3.** E' gia' coperta: il Mandate si rivaluta a ogni
  `run.intended`, e ogni tentativo e' un turno.

## Compromessi accettati

- Accettiamo due archivi durevoli (il registro e il journal di Atomic) in cambio di un motore
  sostituibile. La chiave comune e' `RunId`, e il solo punto in cui possono divergere e' `reconcile`.
- Accettiamo che Atomic non misuri i token dentro `claude -p`: la spesa la legge e la limita
  l'executor dall'output JSON. Atomic limita solo la durata. In cambio pstack gira come plugin vero,
  con i suoi hook.
- Accettiamo che "stesso contenuto, stesse cause" voglia dire "stesso fatto". Due azioni reali
  identiche devono differire nel corpo (`requestId`, versione nativa). Un errore in cosa entra
  nell'id fonde due eventi senza avvisare.
- Accettiamo il costo delle viste e l'evoluzione degli schemi (viste con versione, ricostruzione
  per replay) in cambio di uno stato che non puo' divergere dalla storia.
- Accettiamo un solo scrittore serializzato. Il carico e' il traffico GitHub di un team, e SQLite in
  WAL lo regge.
- Accettiamo che un worker veda i follow-up solo tramite il tool MCP `inbox` durante il run,
  oppure al tentativo successivo.

## Alternative considerate

- **Tabelle mutabili con eventi emessi a fianco (dsh cosi' com'e').** Interfaccia della stessa
  dimensione, ma nasconde meno: la subscription vive in tre relazioni e gli id non sono stabili.
  Perde sulla proprieta' divisa dello stato.
- **Il journal di Atomic come unico registro.** Ha meno archivi, ma gli mancano gli RPC, le chiavi
  di replay della UI si rompono quando il file del workflow cambia, i fatti del servizio non sono
  legati a un run e il motore non sarebbe piu' sostituibile.
- **Il worker come agente nativo di Atomic con le SKILL.md di pstack.** I token verrebbero misurati,
  ma senza gli hook di Claude Code le pause obbligatorie tornerebbero a essere solo testo.

## Riconciliazione durante l'implementazione

(vuota: si riempie in fase D)

## Domande aperte e rischi

1. **Atomic serve ancora?** Con il worker su `claude -p`, Atomic fa girare quattro passi per
   tentativo, tiene un journal e limita la durata. Non misura i token, non gestisce i gate e non
   possiede lo stato. Il registro del servizio potrebbe tenere da solo quei quattro passi. Va deciso
   se tenerlo, visto anche il punto 2.
2. **La licenza AGPL di `mupdf`**, che `@bastani/atomic` porta con se' tramite `markit-ai`.
   Aggiornamento del 02/11: il progetto e' per uso locale e personale, non e' un servizio offerto ad
   altri in rete, quindi gli obblighi dell'AGPL non dovrebbero scattare. Non e' un parere legale.
   Torna rilevante solo se l'harness venisse distribuito o offerto ad altri.
3. **`run(def, inputs, { runId })` riprende un run dopo un crash?** Oppure `reconcile` deve passare
   da `session.workflows.resume`? Va provato con uno script breve prima di scrivere `executor.ts`.
4. **`claude -p` riporta il costo?** Verificato il 02/11 su questa macchina (Claude Code 2.1.316):
   con `--output-format stream-json --verbose` il risultato ha `total_cost_usd` e `session_id`,
   l'init elenca il plugin pstack con 43 skill, e l'hook SessionStart inietta poteto-mode anche
   senza persona. Un "OK" di un turno e' costato 0,14 $ (misurato, un solo campione, quasi tutto
   creazione della cache di un prompt con sei plugin). Le sessioni worker vanno avviate con i soli
   plugin che servono. Non e' ancora verificato che un hook PreToolUse blocchi un'azione in `-p`.
5. **Il verificatore e' "un altro agente, stesso modello"** per via dell'override solo `opus`. Basta
   per consegnare in automatico il lavoro speculativo? pstack chiede una famiglia di modelli diversa.
6. **Quanto puo' aspettare un commento di review** prima che il worker lo veda? Il tool `inbox`
   durante il run e' sufficiente?
7. **Come si conserva o si compatta il registro?** Il testo spostato fuori dal contesto (spill)
   cresce senza limite.

## Prossimo passo

Scrivere `log.ts` (`transact`, `idOf`, ricostruzione delle viste) con un test di proprieta':
ripassare gli eventi salvati in un registro vuoto deve dare gli stessi id e gli stessi valori delle
viste. Non dipende da nessuna delle domande aperte.
