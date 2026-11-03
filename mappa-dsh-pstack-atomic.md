# dsh-superagent mappato su pstack e Atomic

Scritto il 02/11/2026. Fonti, una per agente, con citazioni file:riga:

- `riferimenti/dsh-superagent/analisi/dsh-docs.md`: README, SETUP, 9 documenti, prompt, skill del repo `uppifyagency/dsh-superagent-prototype` (commit `6337fc8`, 31/10).
- `riferimenti/dsh-superagent/analisi/dsh-code.md`: tutto `src/`, test letti per titolo e fixture. I test non sono stati eseguiti (mancano le dipendenze DSH).
- `riferimenti/pstack/feature-map.md` (prima versione: `~/src/ext/dsh-superagent-mappa/fonti/pstack-concepts.md`): `~/src/pstack-claude` al commit `8ecae68` (plugin 0.9.117). La deep wiki di pstack esiste (`riferimenti/pstack/deepwiki/`), scaricata dopo questa mappa.
- `~/src/ext/dsh-superagent-mappa/fonti/atomic-concepts.md`: deep wiki locale (export del 30/08) e clone `PROGETTI ANTYGRAVITY/atomic` al commit `d4aff4e4f` (29/08). Il clone e' **3.179 commit indietro** rispetto a upstream (`790368f2f`, 02/11, release 0.9.63). Titoli dei commit nuovi in `~/src/ext/dsh-superagent-mappa/fonti/upstream-commits.txt`. **Questa mappa usa Atomic al 29/08**: la feature map aggiornata alla 0.9.63 sta in `riferimenti/atomic/feature-map.md`.

## In una riga per sistema

| Sistema | Cos'e' | Livello |
|---|---|---|
| dsh-superagent | Servizio sempre acceso che ascolta un repo GitHub (e Feishu), decide se una richiesta e' autorizzata, apre un Ticket con sessione e worktree propri, risponde con una PR. SQLite, coda di effetti durevole, pannello web | **Servizio**: ascolto, autorizzazione, coda, durabilita' |
| Atomic | CLI locale (fork di Pi) con motore di workflow durevole (DBOS su Postgres), budget, sessioni e subagent | **Motore di esecuzione**: run ripresi dopo un crash, stati, budget |
| pstack | Istruzioni caricate nel prompt: playbook, ruoli e modelli, verifica, review. Nessun processo, nessun evento | **Metodo**: come lavora un agente dentro una sessione |

I tre non sono alternativi: si impilano. dsh sta sopra (decide **se** e **quando** lavorare), Atomic in mezzo (fa girare il lavoro in modo durevole), pstack dentro ogni sessione (decide **come** lavorare e quando dire "fatto").

## Mappa concetto per concetto

Legenda: **=** equivalente, **~** parziale, **-** assente.

| Concetto dsh | pstack | Atomic |
|---|---|---|
| **Source**: polling GitHub (notifiche, PR, CI, ogni 60 s minimo), Feishu quasi in tempo reale. Nessun webhook nel codice | - Nessun ascolto. Solo l'hook SessionStart e il poller `watch-pr` dentro una sessione viva | - Nessun webhook ne' cron. Si arriva da fuori con estensione (`pi.on`) o pilotando SDK/RPC |
| **Trigger / Thread / Subscription**: ogni evento e' un Trigger su un Thread; il contesto passa, l'autorita' no | ~ `inbox/` di orchestrate con punti di svuotamento | ~ `inputs` di un run di workflow |
| **Eval**: regola fissa poi giudizio del modello; un si'/no con motivo per **ogni** regola attiva | ~ `poteto-mode` classifica il task e sceglie uno dei 23 playbook, ma non decide se il lavoro e' autorizzato | - |
| **Mandate**: record immutabile di cosa e' autorizzato e perche', rivalidato alla ripresa contro la Policy di oggi | ~ Livelli di autonomia e "pausa sempre" per force-push, deploy, cancellazioni, messaggi ai clienti; ordini permanenti in `preferences.md` | - Solo trust del progetto (cosa caricare), nessun modello di utenti |
| **Accept mode** `off` / `observe` / `auto`: in observe registra "avrei accettato" senza agire | - | - |
| **Main Session (router)**: smista e basta, nota di massimo 30 parole, vietato scrivere piani | ~ Il runner di poteto-mode e orchestrate, che pero' pianificano (architect) | ~ Sessione padre con subagent a un solo livello |
| **Ticket** | ~ Unita' di orchestrate (`units.tsv` e brief) | = Un run di workflow per item (pattern issue-to-pr, `workflows.md:374-600`) |
| **Executor Session + worktree** per Ticket | = `poteto-agent` in un worktree proprio | = Sessione di stage con git worktree |
| **Stati del Ticket** (tabella "vince la prima riga", per chi aspetta) | ~ Todolist copiata dal playbook, stati in `units.tsv` | = `RunStatus`: pending, running, paused, completed, skipped, cancelled, **blocked**, failed, killed |
| **`human_action`**: domanda strutturata, posta dove la persona ha scritto | ~ `gates.md`, cancelli parcheggiati e raggruppati | ~ `ctx.ui`, `needs_human`, `contact_supervisor` |
| **Risposte con scopo dichiarato**, tetto 100 parole imposto dal codice | ~ Solo regole di stile nel prompt (`unslop`, `ketchup`) | - |
| **Coda di effetti "salva poi fai"**, outbox ordinata, id derivati dal contenuto | ~ Principio `make-operations-idempotent`, checkpoint `resume.mjs` | = `ctx.tool` con effetti in cache che non rigirano dopo la ripresa (DBOS) |
| **Ripresa dopo crash** con conteggio esatto degli input letti | ~ `resume.mjs`, pause-safely, session-pickup | = Run durevoli su Postgres |
| **Slot di concorrenza + uno riservato agli umani** | ~ Finestra mobile di circa 10 agenti in orchestrate | ~ Worker pool (solo upstream, dai titoli dei commit, non verificato) |
| **Budget** di tempo, token, costo | - Solo un tempo "stuck-after" per agente | = `maxDurationMs`, `maxTokens`, `maxCost` con chiusura morbida e terminale `budget_exceeded` |
| **Verifica del risultato** | **Piu' forte di dsh**: skill `verify` che guida l'app reale, ledger per SHA, verdetto solo da chi non ha scritto il codice | ~ Loop di review che, se non converge, finisce in `blocked` |
| (dsh: nessun codice controlla test o CI, solo testo nei prompt) | | |
| **Review dei bot**: massimo 3 giri per revisore automatico, i bot sono "input fallibile" | ~ `babysit`, `fix-ci`, due tentativi poi abbandono | ~ Come sopra |
| **Pannello web** che resta vuoto quando va tutto bene | ~ `ketchup` in chat | ~ Pannello TUI; guida per incorporare Atomic in un web server (upstream #3483, non verificato) |
| **Script di servizio con exit code** 0/1/2/3 e controllo orario fatto da un agente | ~ Tick orario di autopilot via `/loop` | - |
| **Override dei prompt che ricordano la base** ("Default updated" con diff) | ~ Override sheet dei modelli, non dei prompt | ~ Skill e prompt template |
| **Documenti e superficie del modello testati** (budget di caratteri per ruolo, tabelle dei moduli = file reali) | ~ `correct` e `encode-lessons-in-structure` trasformano lezioni in lint | - |
| **Setup guidato da un agente**, una domanda per messaggio | ~ `setup-pstack` | ~ Installer |
| **Miglioramento di se'** | = `reflect`, `correct` | - Non visto nel sorgente letto |

## Cosa ne esce

1. **Lo strato di dsh manca a tutti e due.** Ascolto di eventi, Mandate, Policy, modalita' observe, pannello: ne' pstack ne' Atomic li hanno. Per avere un "dsh" bisogna costruirlo sopra, oppure usare dsh stesso (che pero' gira solo dentro DeepSeek Harness).
2. **Atomic copre bene il centro.** Run durevoli, stati con `blocked`, budget, effetti che non si ripetono: e' la parte che dsh si costruisce da solo con SQLite e coda di effetti. Ma va riletto sull'upstream, perche' la copia locale ha 2 mesi.
3. **pstack copre meglio la verifica.** dsh dichiara le regole di prova solo nei prompt, e nessun codice le applica. pstack ha il verdetto legato allo SHA e il revisore indipendente.
4. **Il principio che dsh aggiunge e gli altri non hanno: l'attenzione umana come unico costo.** Si vede nel tetto di 100 parole imposto dal codice, nel pannello vuoto quando va tutto bene e nel router a cui e' vietato pianificare.

## Idee da portare nel turno GHL (ipotesi, non confrontate col codice GHL)

| Idea dsh | Dove sta | Perche' potrebbe servire |
|---|---|---|
| Modalita' `observe` prima di `auto` | `src/policy.ts:55`, `docs/002-authorization.md:98-101` | Una regola nuova del turno registra "avrei fatto" per qualche giorno prima di agire davvero |
| Id derivati dal contenuto + marker nascosto prima di ogni invio esterno | `src/core/ids.ts:3`, `github-channel.ts:34` | Consegne su Slack e scritture che non si duplicano dopo un retry |
| Coda "salva poi fai" nella stessa transazione | `src/app/effects.ts:61-134` | Ripresa dopo crash senza rifare effetti gia' fatti |
| Budget di caratteri per ruolo testato | `tests/model-surface.spec.ts` | Lo stesso problema dei 20.000 byte di AGENTS.md (commit `5f49f0c`), fermato da un test |
| Ogni sessione registra la revisione di prompt che ha usato | `src/app/sessions.ts:329`, `prompts.ts:186` | Sapere con quale versione di skill e spec e' nata una consegna |
