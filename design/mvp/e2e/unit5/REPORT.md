# Unita' 5, prova dal vivo (02/11/2026)

Stessa home dell'unita' 4 (policy `auto`), utente di Vlad, `harness run --every 20`, router reale
(Claude Code, Opus), worker Sol. Issue di prova:
https://github.com/uppifyagency/harness-sandbox/issues/4 ("prima chiedimi se NOTE-A.md o NOTE-B.md").
Log in `logs/` (`run-a.log` = processo ucciso, `run-b.log` = processo riavviato).

| Passo | Esito | Evidenza |
|---|---|---|
| Il router accetta e conferma nell'issue | PASS | commento 6578357180, 0,082 $ |
| Il worker chiede con `ask_user_question` -> `gate.opened` | PASS | gate `04a8ada3...`, 13:27:40. Notifica macOS vista da Vlad |
| Il router pubblica la domanda con le opzioni | PASS | commento 6578375780, 0,120 $ |
| `kill -9` del daemon con il gate aperto | fatto | 13:28:40; nel registro `gate.opened` e `run.bound`, nessun `run.ended` |
| Risposta in un commento ("NOTE-B.md, grazie") -> `gate.answered` | PASS | il router normalizza su `NOTE-B.md`, 0,155 $ |
| Ripresa dopo il lease | PASS | `resume` rifiutato 5 volte ("actively running in another Atomic session"), riuscito alle 13:30:06, circa 86 s dopo il kill |
| La domanda riproposta ritrova lo stesso gate | PASS | "gate 04a8ada3... reasked", risposta subito disponibile; un solo `gate.opened` nel registro |
| Il worker usa la risposta | PASS | commit `19564a1` "docs: aggiungi NOTE-B.md", nessun NOTE-A.md |
| Nessun push | PASS | `main` su GitHub resta `f4f2daf` |
| Il guard blocca `git push` con il motivo | PASS solo in test | `test/gates.test.ts`; dal vivo nessun worker ha tentato un push |

**Costi (misurati).** Router: 0,082 + 0,120 + 0,155 = 0,36 $ per accettare, chiedere e normalizzare la
risposta (equivalente API riportato da `claude -p`, sul piano consuma limiti). Worker: 0,067 $, 48 s,
5 turni secondo il record di Atomic dopo la ripresa. Questo numero quasi certamente **non include**
la parte prima del kill (la fase ripresa ha un nuovo tentativo di modello; non ho verificato se Atomic
somma i due), quindi il costo vero del worker e' piu' alto.

**Difetto trovato e corretto:** dopo il primo `start`, il ciclo di `run` stampava "resuming" per un run
che lo stesso processo possedeva gia' (`resume` usciva subito, nessun effetto). Ora `startRuns` salta i
run posseduti (`engine.owns`).
