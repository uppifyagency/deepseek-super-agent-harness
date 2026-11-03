# Unita' 4, prova dal vivo (02/11/2026)

Atomic 0.9.63, worker `openai-codex/gpt-6.1-sol:high`, utente di Vlad (utente `harness` rimandato),
repo `uppifyagency/harness-sandbox`. Home nuova creata con `seed.ts`: poll reale, poi le stesse
decisioni del router dell'unita' 3 (accept su #2 e #3, ignore su #1), passate da `Harness.decide`.
Poi `harness work`. Log in `logs/`.

| Prova | Esito | Evidenza |
|---|---|---|
| Ticket accettato -> `run.intended` | PASS | 2 `ticket.opened`, 2 `run.intended`; ripianificare non aggiunge niente (test) |
| `run.bound`, `run.progress`, `run.ended` nel registro | PASS | 2 eventi per tipo; avvio senza turni del modello, bound in circa 110 ms |
| Commit nel worktree | PASS | #2: `411c2c7`, una riga in italiano nel README. #3: `b21f84d`, solo l'H1 cambiato. Un commit ciascuno, worktree puliti |
| Nessun push | PASS | `ls-remote`: `main` resta `f4f2daf`. Il guard non ha dovuto bloccare niente (0 BLOCKED) |
| Mandato di pstack nella fase | PASS | `guard.log`: 12 turni su 12 con `mandate=true poteto=true askoff=true`, cwd nel worktree |
| Due run insieme, clone vuoto | PASS (1 campione) | Primo tentativo, senza coda: il secondo `gh repo clone` falliva ("destination path already exists"). Con la coda per clone: un clone, due worktree |
| Domande | nessuna | Nessuna domanda di continuazione o del worker in questa prova |
| **Costo reale di un ticket** | misurato | #2: 0,120 $, 54 s, 6 turni. #3: 0,120 $, 56 s, 6 turni. Primo tentativo di #3: 0,123 $, 67 s |

**Cosa misura il costo.** E' il campo `cost` dei `modelAttempts` di Atomic, che "somma il costo totale
riportato dal provider" (documentato, api-reference.md:1064). Per Sol sul login Codex e' il prezzo a
token del catalogo, non un addebito: sul piano ChatGPT consuma limiti che non misuriamo. Copre solo la
fase `work`: il verificatore (unita' 6) e il router si aggiungono. Ticket di una riga: un ticket vero
costera' di piu'. La cache dei prompt pesa: circa 198.000 token letti dalla cache contro 44.000 nuovi.

**Bug trovati e corretti durante la prova:**
1. Clone concorrente (sopra). Corretto in `workspace.ts` con una coda per clone. Il test locale copre
   solo il caso con clone gia' presente; la corsa sul clone e' provata solo da questa esecuzione.
2. Forma di `getRun` diversa da quella supposta: gli output della radice stanno in `result.attempt`, le
   fasi in `stages[]` (non `graph.nodes`), la durata in `durationMs`. Il primo tentativo aveva
   classificato `budget` un run riuscito (`first-try-run-6762e913.json`, nel registro della home di
   prova restano quei due `run.ended` sbagliati). Il test di `classify` ora usa la forma osservata.
