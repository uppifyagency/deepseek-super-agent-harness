# A3, ticket silenziosi: prova dal vivo (02/11/2026)

## Why

Vlad vuole che l'harness lavori in anticipo su cio' che legge nei suoi repo, senza essere chiamato
(articolo DeepSeek, §3.4 "Acting Ahead"). Un risultato utile arriva come PR del bot piu' un solo commento
nell'issue. Un risultato inutile si scarta in silenzio: zero commenti su GitHub e una riga `DISCARDED` in
`harness`. E' l'unita' 12 del `build-plan.md` e la PR A3 del piano `piano-allineamento-deepseek.md`.

Si accende per repo, solo con `listen: candidates`:

```json
{ "repo": "owner/name", "listen": "candidates",
  "speculative": { "enabled": true, "maxPerDay": 3, "budget": { "maxCostUsd": 1 } },
  "candidateMatch": "bug|errore" }
```

`maxPerDay` (predefinito 3) e `budget` (predefinito 1 $ e 20 minuti) valgono solo per i ticket silenziosi.
`candidateMatch` e' facoltativo. Senza `speculative` un repo si comporta come prima.

Limite del `budget`. Atomic 0.9.6x controlla costo e durata solo ai confini: prima di una fase, ai tool
durevoli e quando la fase finisce. Dentro la fase `work` il worker puo' superare il tetto e Atomic lo ferma
solo alla fine della fase. La lane 8 ha speso 0,195 $ su 0,01 $. Il `budget` silenzioso limita quindi le
fasi successive, non la fase `work`. La spesa di una fase `work` resta da prevedere come per un ticket
visibile.

Dopo l'accensione conta solo il nuovo. L'harness scrive nel registro un fatto `speculative.set` quando
`speculative` di un repo cambia, e il momento dell'ultima accensione resta dopo un riavvio. Un messaggio
non indirizzato e creato prima di quel momento (`created_at` di GitHub) si scarta nel filtro in codice con
`before-speculative`, anche se il poll lo rilegge o qualcuno lo modifica dopo. Una chiamata con `/harness`
passa come prima.

Un commento nuovo su un'issue vecchia e' un messaggio nuovo. Se e' scritto dopo l'accensione e passa
`candidateMatch`, va al router come candidato e puo' aprire un ticket silenzioso, anche se l'issue esiste da
prima. Lo dice la verifica dal vivo di A3 ed e' voluto: conta la data del messaggio, non quella dell'issue.

## Come funziona

1. Il router riceve un messaggio non indirizzato all'harness, marcato `speculative` nella scheda. Lo accetta
   con `silent: true` oppure lo ignora. Il codice rifiuta `silent` su un repo senza `speculative`, su un
   messaggio che chiama l'harness e su un thread che ha gia' un ticket. Oltre `maxPerDay` nelle ultime 24 ore,
   o se nel frattempo qualcuno ha chiamato l'harness nello stesso thread, la decisione diventa `ignore`.
2. Il ticket nasce silenzioso: nessuna conferma. Il codice rifiuta ogni risposta del router in quell'issue.
3. Quando si libera uno slot, i run visibili partono prima dei silenziosi. Non si interrompe niente.
4. Il worker riceve un paragrafo in piu' nel brief: confermare il problema, consegnare solo una correzione
   piccola, altrimenti chiudere `blocked`.
5. Fine del run:
   - PASS del verificatore: il bot apre la PR `[speculativa] <titolo>` e il daemon scrive un solo commento,
     `Ho preparato una correzione in anticipo: <link>`. Da quel momento il ticket e' visibile.
   - Ogni altra fine (FAIL, budget, domanda del worker, errore, blocked, stop): `ticket.closed` con
     `discarded`, nessun commento, worktree rimosso, una riga `DISCARDED` in `harness`.
6. `/harness` di un utente ammesso nello stesso thread rende visibile il ticket. Il daemon scrive la conferma
   `Ci stavo gia' lavorando in anticipo. Da ora seguo questo ticket qui: ti scrivo quando la PR e' pronta.`,
   il messaggio arriva al worker, e da li' domande e risultati seguono la via normale.

I testi che Vlad deve approvare sono il commento di consegna, la conferma di promozione e il prefisso
`[speculativa] ` del titolo della PR.

## Ambiente

Utente di Vlad, Mac reale, repo privato `uppifyagency/harness-sandbox`. Testa `229fd15` per le lane, trunk
`6e9beeb`. Una home per lane in `/tmp/swarm-a3/worker-<n>/home`, comando `/harness-s<n>`, `harness run
--every 20` a mano (nessun plist). Un solo checkout della testa e uno di trunk, condivisi in sola lettura dalle
lane, al posto di un worktree per lane. La home si prepara con `lane.sh`; la lane 1 su trunk usa
`trunk-lane1.ts`.

Le lane condividono il sandbox con gli agenti di A1, A2 e A5. Con `listen: candidates` ogni loro messaggio
sarebbe arrivato al router di ogni lane. Per questo ogni home ha `candidateMatch` uguale a `\[a3-s<n>\]` e
ogni issue di prova ha quel prefisso nel titolo. Un messaggio che chiama l'harness (`/harness-s<n>`) passa
comunque. Trunk non ha `candidateMatch`, quindi `trunk-lane1.ts` porta nel registro di trunk solo l'issue
gemella #73, sveglia una volta il router di trunk, invia le sue risposte e pianifica i run senza avviarli.

Niente PNG: il Chrome di chrome-devtools non ha la sessione GitHub e il repo e' privato. Lo stato di GitHub e'
catturato come testo con `gh` (`logs/a3-gh-stato.txt` e nelle catture di ogni lane). Niente video, per lo
stesso motivo.

## Lane

| Lane | Esito | Evidenza |
|---|---|---|
| 1. Trunk contro testa | PASS sulla testa; trunk fallisce, registrato contro trunk | `logs/a3-trunk-vs-head.txt`. Testa, issue #69: PR #78 `[speculativa] ...` di `lunadelera-ops` e un solo commento, `Ho preparato una correzione in anticipo: .../pull/78`. Trunk, issue gemella #73: il router accetta un messaggio che non lo chiamava, scrive la conferma e pianifica un run visibile |
| 2. Candidato impossibile (`scripts/somma-a3.sh` non esiste) | PASS | `logs/a3-fail.txt`, dalla home della lane 6 (issue #74): zero commenti, `DISCARDED`, worktree rimosso. Il motivo stampato era `budget` per il difetto di `classify` qui sotto, corretto dopo in `7cc3f1b`; non rifatto dal vivo |
| 3. Candidato che spinge a una domanda | PASS | `logs/a3-gate.txt`, issue #70: il worker chiede "which greeting should `scripts/ciao.sh Vlad` print?"; nessun `gate.opened`, la domanda non compare nell'issue, il worker riceve l'ordine di fermarsi e chiude `blocked` con zero commit, `DISCARDED  ...  question: ...`, worktree rimosso, zero commenti |
| 4. `/harness-s4 procedi tu` durante il run | PASS | `logs/a3-promosso.txt`, issue #71: `ticket.promoted (handle)`, conferma nell'issue, messaggio consegnato al worker (`input.delivered`), PR #76 con il titolo senza prefisso, poi il router riporta `Correzione pronta: .../pull/76` |
| 5. Tre candidati con `maxPerDay` 2 | PASS | `logs/a3-tetto.txt`, issue #66, #67, #68: due `accept` silenziosi e due `run.intended`; il terzo resta `decided ignore: speculative cap: 2 per day`, senza ticket ne' run; zero commenti. Solo `tick` e `planRuns`, nessun worker |
| 6. Visibile con lo slot occupato da silenziosi | PASS | `logs/a3-precedenza.txt`, `maxWorkers` 1: silenzioso #74 in corso, silenzioso #75 in coda (`run.intended` 19:17:08), visibile #77 deciso alle 19:17:35. Il #74 finisce alle 19:17:41,3 e il visibile parte alle 19:17:44,9, prima del #75 piu' vecchio. Daemon fermato dopo l'avvio del visibile |
| 7. Repo con `listen: explicit` | PASS | `logs/a3-explicit.txt`, issue #64: `DROP not-addressed`, nessuna sveglia del router, nessun ticket. Con `speculative.enabled` e `explicit` la config si rifiuta di caricare |
| 8. Budget silenzioso esaurito | PASS | `logs/a3-budget.txt`, issue #72, budget 0,01 $: `stopped by budget at $0.20`, `ticket.closed discarded: budget`, nessuna domanda "Continuo?", zero commenti, worktree rimosso |
| 9. Messaggio di uno sconosciuto | PASS | `logs/a3-sconosciuto.txt`, issue #65, `allowedActors` della lane senza `uppifyagency`: `DROP actor-not-allowed` nel filtro in codice, nessuna sveglia del router |
| 10. `kill -9` del daemon durante il run silenzioso | PASS | `logs/a3-ripresa.txt`, stesso run della lane 1: `kill -9` alle 19:15:38, ripresa dopo il lease alle 19:17:43, verifica PASS, consegna con un solo commento. Il ticket e' rimasto silenzioso: nessuna sveglia del router in quella home oltre la prima |

Le lane 1 e 10 hanno usato lo stesso run, la lane 2 la home della lane 6, per restare entro 4 ticket interi.
Ticket interi (worker, verificatore, PR): 2 (lane 1 e lane 4). Nessun "usage limit" nei log.

## Perf

Consumo per ticket, in $ di listino (misurato: costo del worker da Atomic, del verificatore e del router da
`claude -p`). Sugli abbonamenti e' consumo di finestre d'uso, non spesa.

| Lane | Esito | Worker | Verificatore | Router | Durata del run |
|---|---|---|---|---|---|
| 1 (silenzioso consegnato, con `kill -9`) | done | 0,083 | 0,085 | 0,050 | 92 s |
| 3 (domanda) | scartato | 0,107 | 0 | 0,052 | 26 s |
| 6, #74 (impossibile) | scartato | 0,099 | 0 | 0,164 per 2 sveglie (3 issue) | 31 s |
| 8 (budget 0,01) | scartato | 0,195 | 0 | 0,049 | 93 s |
| 4 (promosso) | done | 0,198 | 0,080 | 0,144 | 121 s |
| 5 (3 decisioni, nessun run) | | | | 0,086 | |

Come leggere i numeri:
- Il costo del worker della lane 1 puo' essere sottostimato: il run e' stato ucciso con `kill -9` e ripreso,
  e la somma viene dal record di Atomic del run ripreso. E' un'inferenza, non verificata.
- Un silenzioso scartato e' costato da 0,10 a 0,20 $ di worker, senza verificatore. Uno consegnato 0,22 $ in
  tutto. Un campione per caso.

| Regola | Misura | Esito |
|---|---|---|
| Un visibile non aspetta sulla testa piu' di un giro (20 s) oltre trunk | Lane 6: dalla decisione all'avvio 9,1 s, di cui 5,6 s con lo slot occupato dal silenzioso. Su trunk il run parte nello stesso giro della decisione | PASS (misurato, un campione) |
| Un silenzioso non supera il suo `budget` | Lane 8: 0,195 $ su 0,01 $. Atomic controlla il budget fra le fasi, non dentro la fase `work` | FAIL (misurato). Con Atomic 0.9.6x questa regola non puo' passare: il controllo di costo e durata gira solo ai confini di fase e di tool durevole, quindi la fase `work` arriva sempre in fondo prima dello stop. Con il budget predefinito di 1 $ nessun silenzioso l'ha superato |

Deviazione dalla sonda del piano: non 3 + 3 issue alternate su trunk e sulla testa, che erano 12 ticket contro
il limite di 4. I numeri vengono dalle lane. La base di trunk dall'issue alla PR e' quella di A1 (248 s su
trunk, 193 s sulla testa, `e2e/a1/REPORT.md`), documentata e non rimisurata.

## Revisione

- Architect: tre runner opus a effort medium, giudice incrociato saltato (la lista e' solo opus, la stessa
  famiglia della sessione padre). I tre candidati convergevano sulla visibilita' a senso unico su
  `ticketsView`, su `ticket.promoted` e sulla cancellazione di `RunSpec.visibility`. Base il candidato 3.
- Interrogate: tre revisori opus a effort medium, ognuno con una prova eseguita. Cinque difetti verificati e
  corretti in `229fd15`: il router poteva rispondere prima di decidere; un `/harness` arrivato con la
  valutazione ancora aperta creava due ticket; `speculative.enabled` e `maxPerDay` non erano validati;
  `quit()` metteva il run in pausa invece di chiuderlo; un ticket scartato dal percorso `lost()` teneva il
  worktree.
- Dalle lane: `classify` leggeva un worker `blocked` come budget esaurito (`7cc3f1b`, difetto di trunk).

## Pulizia

Nessun plist installato, nessun processo `cli.ts run` delle lane rimasto, home e checkout in `/tmp/swarm-a3`
cancellati (le catture sono in `logs/`). Issue #64-#75 e #77 chiuse con una nota. PR #76 e #78 chiuse senza
merge, branch del bot cancellati.

## Aperto

- Accendere `candidates` su un repo che ha gia' una storia: corretto in `af72a49`, vedi sotto.
- Budget dentro la fase `work` (lane 8, sopra): limite di Atomic 0.9.6x, documentato sopra, non corretto.
- Una domanda fatta con `select` invece di `questionnaire` non vede l'ordine di fermarsi: il worker continua,
  verify e publish lo rifiutano, e paga al massimo il budget silenzioso.
- Con A2 il consumo di `stop.intended` puo' sostituire la risposta "fermati" alla domanda di un silenzioso.
- `node tools/check-publish.mjs` fallisce su 16 percorsi in `design/mvp/e2e/a1/logs/fix2/` della base A1.
  I file di A3 passano.

## Dopo il restack (02/11/2026, testa `af72a49` su `65c6d9a`)

Tre punti aperti dopo il restack di A3 su A1 e A1b.

1. Rilettura della storia. Prima un repo con `speculative` acceso rileggeva al primo poll tutta la storia, e ogni
   vecchio messaggio di Vlad poteva diventare un ticket silenzioso, fino a `maxPerDay`. Ora:
   - `openHarness` scrive un fatto `speculative.set` nel thread `system:policy` quando l'interruttore di un
     repo cambia rispetto all'ultimo fatto (`harness/src/service.ts:214-221`, chiamata a `:226`). La causa
     e' il fatto precedente dello stesso repo, quindi spegnere e riaccendere scrive un fatto nuovo con un
     momento nuovo. Il tipo e' in `harness/src/domain.ts:100`.
   - `ingest` passa al filtro `beforeSpeculativeOn` confrontando `created_at` di GitHub con il momento
     dell'ultima accensione (`harness/src/service.ts:244`, `:251`). Il filtro scarta con `before-speculative`
     un candidato non indirizzato (`harness/src/service.ts:57`). `created_at` arriva da `github.ts:56` e
     `:67`. Una rilettura nei 5 minuti di sovrapposizione o una modifica successiva tengono la data di
     creazione e restano scartate. Una chiamata `/harness` passa prima di questa riga, come prima.
2. Budget. Nessun contatore dentro la fase. Il limite e' scritto sopra, nella config e nella regola di perf.
   Fonte: misurato nella lane 8; nel codice installato di Atomic 0.9.64 il controllo `checkpoint` del budget
   gira dopo la fase (`dist/builtin/workflows/src/index.js:74576`), ai tool durevoli e prima di una fase;
   la documentazione dice che all'esaurimento la fase gia' viva riceve un turno di chiusura
   (`docs/workflows/operations.md:777`).
3. Ripresa di A1b e scarto di A3. Un silenzioso ripartito prima del primo checkpoint resta silenzioso e su un
   solo tentativo: il nuovo `run.bound` tiene lo stesso `run.intended`, `planRuns` non pianifica niente,
   nessuna risposta in coda, nessuna sveglia del router. Il test lo mostrava gia' prima. Un difetto c'era:
   se il ticket era gia' `discarded` (una domanda del worker, poi il daemon muore) e Atomic rifiutava la
   ripresa per zero progressi, `afterResumeError` rispondeva `start-again` e un worker nuovo spendeva il
   budget su un ticket che verify e publish rifiutano. Ora un ticket chiuso porta a `give-up`
   (`harness/src/engine.ts:325`, chiamata a `:255`), e `give-up` passa da `reportEnded`, che rimuove anche
   il worktree (`harness/src/engine.ts:262`). Prima `give-up` chiamava solo `report` e lasciava il worktree.
   Non provato dal vivo: serve una domanda e un `kill -9` prima del primo checkpoint.

Test: `harness/test/routing.test.ts` ("speculative replays no history") e `harness/test/runs.test.ts` ("a
silent run started again before its first checkpoint"), aggiunti in `87a8e21` prima della correzione. Prima
81 test, 79 passati, 2 falliti (`an old message read by the first poll`, `a discarded ticket has nothing to
start again`). Dopo 81 su 81. Cattura in `logs/a3-storia-test.txt`.

### Prova dal vivo: storia

`logs/a3-storia.txt`, `logs/engine-s9.log`. Home `/tmp/swarm-a3f/home`, handle `/harness-s9`, label
`it.delera.harness.s9`, `harness run --every 20` a mano, `candidateMatch` uguale a `\[a3f\]`.

| Passo | Esito |
|---|---|
| Issue #82 `[a3f] ...` creata alle 19:45:34 | prima dell'accensione |
| Home nuova, `speculative.set` alle 19:45:44,677 | punto di accensione nel registro |
| #82 modificata alle 19:45:51, #83 `[a3f] ...` creata alle 19:45:52 | |
| Primo poll: 222 elementi, 221 scartati, 1 al router | #82 `DROP before-speculative`, #83 `PASS candidate` |
| Router: accept silenzioso su #83, run di 130 s | PR #85 `[speculativa] ...` di `lunadelera-ops`, un solo commento in #83 `Ho preparato una correzione in anticipo: .../pull/85` |
| #82 modificata di nuovo, daemon fermato e riavviato, due poll | la nuova versione di #82 `DROP before-speculative`, nessun nuovo `speculative.set`, nessun ticket nuovo |
| GitHub su #82 | zero commenti |

In `harness status` ci sono 117 `drop:before-speculative`. Sono i messaggi umani di Vlad nel sandbox, di
ogni agente, creati prima dell'accensione. Senza `candidateMatch` sarebbero andati tutti al router.
Ticket interi: 1. Consumo in $ di listino (misurato, un campione): worker 0,209, verificatore 0,081, router
0,050.

Pulizia: PR #85 chiusa senza merge e branch del bot cancellato; issue #82 e #83 chiuse con una nota; nessun
processo `cli.ts run` della home rimasto; home `/tmp/swarm-a3f` cancellata.

## Revisione del diff (02/11/2026, testa `82a8239` su `af77b47`)

La verifica dal vivo indipendente ha passato ogni lane. Un commento nuovo su un'issue vecchia che apre un
ticket silenzioso e' voluto: e' un segnale nuovo. Ora lo dicono la sezione sulla config, sopra, e
`rationale.md`. Una revisione indipendente del diff ha trovato cinque difetti non bloccanti e un sesto
minore. I test sono in `cb88c78`, prima della correzione `82a8239`.

1. Risposta del router. Prima bastava una vecchia chiamata `/harness` nel thread perche' il router potesse
   rispondere li' per sempre, anche durante un eval speculativo. Ora `answersCall`
   (`harness/src/routing.ts:233`) accetta solo l'ultima chiamata del thread: una chiamata in attesa del
   router, o l'ultimo eval del thread se era una chiamata fatta dopo la chiusura del ticket. Un eval
   speculativo, aperto o deciso, blocca ogni risposta finche' non arriva una chiamata nuova.
2. `select` in un ticket silenzioso. Prima la risposta "fermati" non era un'opzione, quindi `select`
   restituiva la prima scelta (spesso "Yes" o "Allow") come se l'avesse scelta un umano. Ora restituisce
   `undefined`, cioe' l'annullamento che `HostInput.select` di Atomic ammette (`harness/src/engine.ts:474`).
3. Promozione con `/harness`. Prima un run in coda partiva con il brief e il budget speculativi. Ora
   `planRuns` lo ripianifica con il budget e il brief normali (`harness/src/runs.ts:121`, `:162`). Il run
   nuovo sostituisce quello in coda nella vista dei run (`:32`), e il messaggio del richiedente entra nel
   brief (`:146`). Un run gia' vivo continua: il budget di Atomic e' fisso alla partenza, e fermarlo
   butterebbe il lavoro fatto. Riceve invece uno steer: il ticket non e' piu' speculativo, la regola "solo
   una correzione piccola" non vale piu', e se il budget finisce si chiede al richiedente
   (`harness/src/service.ts:201`, `:271`). Da li' una fine per budget apre la domanda Si'/No normale.
4. Notifica del budget. Un ticket silenzioso fermato dal budget non manda piu' "rispondi nell'issue se
   continuare" (`harness/src/engine.ts:222`, `:331`). Il ticket si scarta e nessuno viene interpellato.
5. Ticket scartato con il run vivo. Ora `engine.stop` (`harness/src/engine.ts:291`) chiama
   `session.workflows.quit()`, scrive la fine `failed/stopped` e rimuove il worktree. Il giro del daemon lo
   chiama per ogni run di un ticket chiuso (`harness/src/cli.ts:70`, `harness/src/runs.ts:208`). Un run di
   un ticket chiuso non e' piu' fra i run vivi (`harness/src/runs.ts:202`), quindi un daemon riavviato non
   lo riprende. Il contratto e i messaggi sono quelli di `engine.stop` in A2.
6. Scarti sulla bacheca. `board().waitingForVlad` mostra al router solo gli ultimi 5 scarti
   (`harness/src/routing.ts:337`). `harness` li mostra ancora tutti a Vlad.

Test. Prima: 53 test nei due file, 45 passati, 8 falliti: due per il difetto 1, due per il 3, uno per ciascuno degli altri
(`logs/a3g-test-prima.txt`). Per avere ogni test rosso e non solo un import fallito, la prima corsa usava un
`budgetNotice` che restituiva sempre il testo, cioe' il comportamento di `af77b47`. Dopo: 89 su 89
(`logs/a3g-test-dopo.txt`).

### Prova dal vivo

Checkout di `82a8239` e di `af77b47` in `/tmp/swarm-a3g/`, home `/tmp/swarm-a3g/g<n>/home`, label
`it.delera.harness.g<n>`, handle `/harness-g<n>`.

Difetto 1, provato (`logs/a3g-risposta.txt`). Home g2, senza daemon: `harness poll --once` e la superficie
MCP del router (`next`, `decide`, `reply`). Issue #111: la chiamata `/harness-g2 ciao`, decisa `ignore`,
riceve risposta (`ok`). Poi un commento non indirizzato `[a3g2] ...` apre un eval speculativo. Con
`82a8239`, `reply` sull'issue viene rifiutata sia con l'eval aperto sia dopo `decide`: "nobody called the
harness on this issue: post nothing". Nell'outbox resta solo `Ciao.`. Con `af77b47`, su una copia della
stessa home, le stesse due chiamate restituiscono `ok` e mettono due risposte in coda. Nessuna risposta e'
partita: in g2 non girava nessun daemon.

Difetti 2 e 5, non provati dal vivo (`logs/a3g-select.txt`, `logs/engine-g1.log`, `logs/daemon-g1.log`).
Due ticket interi su due, e nessuno ha raggiunto `select`:
- #110, con il tool di domanda di pstack acceso (foglio senza `pi ask tool: off`): `ask_user_question` di
  pstack lancia un errore prima di chiamare `select` quando la sessione non ha UI (`pi/ask.ts:61`), e una
  fase di Atomic non ne ha. Il worker chiude `blocked`. Il ticket si scarta con zero commenti. Quindi oggi
  nessun tool di pstack porta una domanda del worker in `select`.
- #112, con un tool di prova che chiama `ctx.ui.select`: il router lo ignora, perche' la stessa richiesta su
  #110 era appena stata scartata. Nessun ticket.
- #113, con un'estensione permission gate come `examples/extensions/permission-gate.ts` di Atomic
  (`select("Allow ...?", ["Yes", "No"])` prima di ogni scrittura, copia in `permission-gate-g1.ts`): il testo
  dell'issue diceva che il README citava lo script, e non era vero. Il worker ha controllato la premessa e
  ha chiuso `blocked` prima di scrivere. Errore mio nel testo, non dell'harness.
Per provarli dal vivo serve un terzo ticket: la home g1, l'estensione `permission-gate-g1.ts` in
negli `extensionFactories` del motore (da `<home>/.atomic/extensions/` non arriva alle fasi del worker, che girano nel worktree; lo ha visto il verificatore) e un'issue con una premessa vera. L'ordine di fermarsi via `select` e il
`quit` restano coperti solo dai test.

Consumo in $ di listino (misurato, dal registro della home g1): worker 0,088 (#110) e 0,115 (#113), router
0,051, 0,083 e 0,116.

Pulizia: issue #110-#113 chiuse con una nota, nessuna PR, nessun commento dell'harness. Nessun processo della
lane rimasto, checkout e home in `/tmp/swarm-a3g` cancellati.

Aperto dalla revisione dei commenti (comment-sicko), non fatto: un segnale di annullamento per `watch` al
posto dell'insieme `quitting`; una risposta "stop" tipizzata da `ask` al posto del confronto con la stringa
`SPECULATIVE_STOP`; lo stato di chiamata del thread come tipo al posto dei ritorni anticipati di
`answersCall`; un campo `replaces` esplicito al posto della sostituzione dedotta da `cause[0]`.
