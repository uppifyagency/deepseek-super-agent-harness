# Unita' 7, prova dal vivo (02/11/2026)

Utente di Vlad, `harness run --every 15`, router reale, Sol, Opus, bot `lunadelera-ops`. Issue
https://github.com/uppifyagency/harness-sandbox/issues/8, PR https://github.com/uppifyagency/harness-sandbox/pull/9.
Home nuova (`../unit6/seed.ts`). Log in `logs/` (`first-try-run.log` = primo tentativo sull'issue #7, vedi sotto).

| Prova | Esito | Evidenza |
|---|---|---|
| Commento durante il run ("aggiungi -l") -> worker, senza turni del router | PASS | `input.routed` 13:54:45, `input.delivered` 3 s dopo dentro la fase; nessun turno del router fra accettazione ed esito |
| Il worker ne tiene conto | PASS | commit 1: "Aggiungi conta-parole con opzione righe e test" |
| Il verificatore giudica sulla richiesta aggiornata | PASS | Opus PASS con `-l` (dopo la correzione sotto) |
| L'iscrizione della PR al ticket | PASS | `subscribed` sul thread #9 a ogni `run.ended` done |
| Commento sulla PR dopo la fine -> tentativo n+1 | PASS | tentativo 2: riga d'uso in cima allo script; tentativo 3: nome del caso stampato. Stessa PR #9, 3 commit |
| Il tentativo n+1 riprende la sessione del tentativo n | PASS dal tentativo 3 | sessione del tentativo 3 con `parentSessionId` = sessione del tentativo 2 e la sua storia (vedi sotto) |
| Una sola PR | PASS | PR del repo: #6 e #9 |

**Bug trovati e corretti:**
1. **Il verificatore non vedeva i follow-up.** Primo tentativo (issue #7): Opus ha bocciato l'opzione `-l`
   come "fuori scope" perche' giudicava sul brief originale; il tentativo 2 avrebbe ricevuto l'ordine di
   toglierla. Fermato l'harness prima della verifica del tentativo 2 (nessun push). Ora il verificatore
   riceve il brief piu' tutti i messaggi del richiedente gia' consegnati, con la regola "il piu' recente
   vince" (`Harness.requirements`, test in `runs.test.ts`). In quella home il tentativo 2 dell'issue #7
   resta legato e non finito: la home non va riusata.
2. **`forkFromSessionId` veniva ignorato.** Il tentativo 2 ha avuto una sessione nuova (nessun
   `parentSessionId`, nessuna traccia della storia del primo): il contesto passava solo da commit e brief.
   Atomic fa il fork solo con `context: 'fork'` (api-reference.md:518-525). Corretto; il tentativo 3 lo prova.

**Costi (misurati, equivalente API):** router 0,06 (accettazione) + 0,12 + 0,18 + 0,23 (tre esiti) $:
la sessione ripresa cresce a ogni sveglia, la rotazione scatta sopra 0,45 $. Verificatore 0,07-0,09 $ a
tentativo.

**Non provato:** un follow-up mentre il run e' in verifica o publish (fuori dalla fase `work`) resta
in attesa e diventa il tentativo successivo: coperto dalla logica di `planRuns`, non da una prova.
