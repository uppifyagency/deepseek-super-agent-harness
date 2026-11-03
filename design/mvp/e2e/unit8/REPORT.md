# Unita' 8, parte budget, prova dal vivo (02/11/2026)

Home nuova con `budget.maxCostUsd` 0,03 $ (`logs/config.json`), policy `auto`, utente di Vlad, router
reale, Sol, Opus, bot. Issue https://github.com/uppifyagency/harness-sandbox/issues/16, PR #17.
Launchd e watchdog (resto dell'unita' 8 e unita' 9) **non** sono in questa prova: aspettano il si' di Vlad.

| Prova | Esito | Evidenza |
|---|---|---|
| Tentativo fermato dal budget | PASS | budget 0,03 $, `run.ended` `budget` a 0,134 $ |
| La domanda di budget compare nell'issue | PASS | commento del router "Continuo con un budget di 0,27 $? 1. Sì 2. No"; voce nella lista dell'attenzione; notifica macOS |
| Non e' un esito finale | PASS | nessun commento "risultato" del router per il tentativo 1 |
| "Sì, continua" -> tentativo 2 con budget alzato | PASS | tentativo 2 con 0,27 $ (2 volte la spesa), `forkFrom` = sessione del tentativo 1, `startFrom` = `67b004b` |
| Il tentativo 2 riprende sessione e commit | PASS | sessione del tentativo 2 con `parentSessionId` = sessione del tentativo 1; nessun commit nuovo, verifica PASS, PR #17 su `67b004b` |
| Lista dell'attenzione vuota alla fine | PASS | `attention: []` |

In piu', non previsto: il worker ha fatto una domanda sul contenuto ("quale regola riporto?"), il router
l'ha pubblicata con tre opzioni, la risposta "1, pausa: decide Vlad" e' stata normalizzata su
"Pausa, decide Vlad" e il file la riporta.

**Cosa misura il budget (fatto osservato).** Atomic controlla il tetto **fra un passo e l'altro**, non
dentro una fase: la fase `work` e' arrivata in fondo e ha committato, poi il tentativo e' stato fermato
prima della verifica (gia' visto nell'E2E S7: "una fase sfora sempre"). Il budget quindi non limita il
costo di una fase singola: limita quanti passi partono dopo che il tetto e' superato. Per questo la
richiesta chiede almeno il doppio della spesa, non il doppio del tetto.

**Costi (misurati, equivalente API):** tentativo 1 0,134 $; tentativo 2 0,112 $ di Sol pur senza
lavoro nuovo (la sessione ripresa si rilegge tutta) + 0,067 $ di Opus; router 0,07-0,28 $ a sveglia
(6 sveglie). Riprendere una sessione costa quasi quanto rifare il lavoro, per un ticket piccolo.

**Bug trovato dai test e corretto:** "Sì" non contava come si': in una regex JavaScript senza flag `u`,
"ì" non e' un carattere di parola, quindi `\b` dopo "sì" non scattava.

**Debito:** con "No" il ticket resta fermo e il worktree del tentativo non viene rimosso.
