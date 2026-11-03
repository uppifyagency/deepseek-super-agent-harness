# Unita' 10, prova dal vivo (02/11/2026)

Home nuova (`../unit6/seed.ts`), policy `auto`, `maxWorkers` 2, utente di Vlad, router reale, Sol, Opus,
bot `lunadelera-ops`. Issue #10, #11, #12 aperte insieme. Log in `logs/` (`run-events.json` = gli eventi
`run.*` del registro con l'ora).

| Prova | Esito | Evidenza |
|---|---|---|
| 3 ticket accettati in un solo turno del router | PASS | 3 `run.intended` alle 15:00:43 |
| Mai piu' di 2 run vivi insieme | PASS | massimo calcolato sugli intervalli `run.bound` -> `run.ended`: 2 |
| Il terzo parte quando uno slot si libera | PASS | slot libero 15:01:49, terzo `run.bound` 15:02:12 (ciclo da 15 s piu' il turno del router) |
| 3 PR, una per ticket | PASS | #13, #14, #15 del bot; unite da Vlad (tramite questa sessione) |
| Dopo una rotazione forzata il router ritrova un ticket con `recall` | PASS | sessione nuova; `logs/mcp.log`: `next`, poi 9 `recall` (ticket -> run -> esito -> thread della PR); risposta corretta: PR #13, chiude #11, verdetto citato |

**Costi (misurati, equivalente API):** router 0,107 $ (3 accettazioni in un turno) + 0,173 + 0,226 $
(esiti); domanda dopo la rotazione 0,130 $ con 14 turni.

**Cosa e' cambiato nel codice:**
- `policy.set` porta `maxWorkers` (1-3, default 2); `harness policy <mode> --workers N`; cambiare modo lo conserva.
- `runsToStart`: un run legato e non finito tiene uno slot, anche se aspetta una risposta; i run non
  legati partono dal piu' vecchio, gli altri aspettano nel registro.
- `recall` accetta `ticket:<id>` e mostra anteprime leggibili di decisioni, run, esiti, follow-up, domande.
- Il server MCP registra ogni chiamata in `<home>/logs/mcp.log`.

**Non provato:** la compattazione del router e' la rotazione della sessione (unita' 3b), forzata qui
cancellando `router-session.json`; non c'e' una compattazione dentro la sessione.
