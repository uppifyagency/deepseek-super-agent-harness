# Unita' 6, prova dal vivo (02/11/2026)

Home nuova (`seed.ts`: policy `auto`, issue #1-#4 gia' decise con ignore), utente di Vlad,
`harness run --every 20`, router reale, worker Sol, verificatore Opus (`claude -p`), bot
`lunadelera-ops` con il token del Portachiavi (`harness-bot-github`). Issue:
https://github.com/uppifyagency/harness-sandbox/issues/5. Log in `logs/`.

| Prova | Esito | Evidenza |
|---|---|---|
| Accettazione e conferma nell'issue | PASS | commento 6578695698 |
| Sol committa nel worktree | PASS | `8dad02a`, un file `CONTRIBUTING.md` |
| Verifica di Opus, sessione nuova, sola lettura | PASS | `PASS`, livello `inspected` (solo documentazione), worktree uguale dopo la verifica, `sameFamily: false` |
| Push come bot e PR con marcatore | PASS | PR #6, autore `lunadelera-ops`, branch `harness/3cc19b00de02`, `Closes #5`, verdetto nel corpo |
| Il router riporta l'esito nell'issue | PASS | commento 6578731211 con il link alla PR |
| Una sola PR anche ripetendo `publish` | PASS | ripetuti push e `openPullRequest`: stesso sha (nessun effetto), stessa PR #6; su GitHub una sola PR |
| Worktree rimosso alla fine | PASS | `git worktree list` mostra solo il clone |
| Nessun merge | PASS | PR #6 `OPEN` |

**Costi (misurati, equivalente API):** worker Sol 0,123 $ (69 s, 6 turni); verificatore Opus
0,099 $; router 0,078 $ (accettazione) + 0,123 $ (esito). Totale del ticket: circa **0,42 $**.
Ticket di sola documentazione: un ticket con test da eseguire costera' di piu' in verifica.

**Provato solo in test, non dal vivo:**
- verdetto FAIL -> tentativo 2 che riprende la sessione del worker (`forkFromSessionId`) e i suoi
  commit (`startFrom`), con il motivo nel brief; nessun tentativo 3 (`test/runs.test.ts`). Se
  `forkFromSessionId` funzioni fra run diversi con lo store SQLite **non e' verificato**;
- commit dopo il verdetto -> `verdictStillValid` falso, publish rifiutato (repo git locale);
- verificatore che modifica il worktree -> verdetto scartato;
- `kill` durante publish: provata l'idempotenza ripetendo publish, non un kill a meta'.

**Rischio trovato e chiuso prima della prova:** la config git globale di Vlad ha
`credential.https://github.com.helper = gh auth git-credential`. Con il token del bot rifiutato, git
avrebbe ripiegato sul token di Vlad. Il push gira con `GIT_CONFIG_GLOBAL=/dev/null` e
`GIT_CONFIG_NOSYSTEM=1`; il token passa da `GIT_CONFIG_*` nell'ambiente, mai negli argomenti.

**Debito:** il commit nella PR del bot ha come autore l'operatore, perche' il
worker usa la config git di Vlad. Si risolve con l'utente `harness` (unita' S) o impostando l'autore
del worker.
