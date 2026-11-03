# A5, harness installabile con setup e doctor: prova dal vivo (02/11/2026)

## Why

Vlad vuole pubblicare l'harness come repo MIT che uno sconosciuto installa con pochi comandi. Questa PR
aggiunge `harness doctor`, che controlla ogni prerequisito e stampa `ok` oppure `manca` con il comando che
lo sistema, e `harness setup`, che fa da solo quello che puo' e chiede solo login, token del bot, repo e
login autorizzati. Porta anche in config il percorso di pstack (`pstackDir`), che prima era scritto in
`engine.ts` e `verify.ts`.

Codice: `harness/src/setup.ts` (nuovo), `harness/test/setup.test.ts` (nuovo), modifiche piccole a
`config.ts` (`parseConfig` separato da `loadConfig`, `pstackDir`, controllo di `botKeychainService`),
`cli.ts` (due righe), `engine.ts` (`ATOMIC_DIR`, `pstackDir`) e `verify.ts` (`pstackDir`).
Testa delle lane: `b2d4f2f`. Trunk: `6e9beeb` (testa di A1, senza setup).

## Forma

Nota del 03/11: dall'integrazione di A2 i passi sono undici, perche' si e' aggiunto `watchdog launchd`. Questo rapporto resta com'era alla prova.

Una sola lista di dieci passi in `setup.ts`. Ogni passo ha un'etichetta, `missing()` che restituisce il
comando che lo sistema (o niente se e' a posto) e, se setup puo' farlo da solo, `apply()`. `doctor` lancia
tutti i `missing()` insieme e stampa in ordine. `setup` li percorre in ordine: `gia' fatto` se e' a posto,
altrimenti `apply()`, poi ricontrolla, e si ferma al primo passo che resta `manca`. L'ordine e' il modello
delle dipendenze (config prima di Portachiavi e servizio). Il design e' uscito da `/pstack:architect` con
tre candidati opus (lista di passi, istantanea piu' pianificatore puro, forma minima). Base: la forma
minima. Il giudice incrociato e' saltato perche' il gruppo dei giudici ha solo opus, la famiglia del
genitore.

Passi, in ordine: macOS, Node >= 26.13.0, Atomic globale (0.9.x da 0.9.63 in su, e `atomic` nel `PATH`),
pstack in `pstackDir`, login Codex di Atomic, Claude Code con il login del piano, `gh` autenticato,
`config.json`, token del bot nel Portachiavi, servizio launchd.

Domande di `setup` (testo esatto), solo quando servono:

- `Repo da seguire (owner/name): `
- `Login autorizzati a dare lavoro (separati da spazi): `
- `Token del bot GitHub (non viene mostrato): ` (in un terminale con `stty -echo`, da una pipe come riga)

I login mancanti partono nel terminale e setup aspetta che finiscano: `atomic` (con la riga "Si apre
Atomic: scrivi /login, scegli OpenAI Codex, poi esci."), `claude auth login`, `gh auth login`. Da una pipe
i login non partono: setup stampa `manca` con il comando e si ferma. Con `--yes` servono `--repo` e
`--allow`. `--label`, `--handle`, `--keychain` e `--pstack` scrivono le chiavi corrispondenti di
`config.json`.

Il token va a `security -i` su stdin, mai negli argomenti (che `ps` mostra). Una home nuova parte in modo
`auto`, cosi' il primo `/harness` di un login autorizzato produce una PR senza altri comandi. Una home che
ha gia' una policy la tiene.

## Lane

Ogni lane ha la sua home `/tmp/swarm-a5/worker-<n>/home`, l'etichetta `it.delera.harness.i<n>`, il comando
`/harness-i<n>` e un servizio di prova del Portachiavi `harness-bot-github-test-<n>`. Nessuna prova su
`~/.harness`, sull'etichetta predefinita o sulla voce `harness-bot-github` (solo letta per la lane 1).
Le catture sono in `logs/`.

| Lane | Esito | Evidenza |
|---|---|---|
| 1. Trunk contro testa, dalla home vuota alla PR | PASS | `logs/a5-trunk-vs-head.txt`. Testa: un solo `harness setup`, issue #57 -> PR #61 del bot in 215 s. Trunk: 5 comandi piu' una modifica a mano di `config.json`, issue #59 -> PR #63 in 220 s |
| 2. `doctor` sul Mac di Vlad con la home di prova | PASS | `logs/a5-doctor-ok.txt`: dieci righe `ok`, uscita 0 |
| 3. Atomic tolto dal `PATH` | PASS | `logs/a5-doctor-atomic.txt`: `manca  Atomic globale, ...: npm i -g @bastani/atomic@0.9.63`, uscita 1 |
| 4. `pstackDir` su una cartella vuota | PASS | `logs/a5-doctor-pstack.txt`: `manca` con `git clone https://github.com/michael-denyer/pstack-claude <radice>` |
| 5. `setup --yes` su una home vuota | PASS | `logs/a5-setup.txt`: clona pstack da GitHub, scrive `config.json`, mette il token, installa il servizio `i5`, chiude con `doctor` tutto `ok` |
| 6. Secondo `setup` sulla stessa home | PASS | `logs/a5-idempotente.txt`: dieci `gia' fatto`, mtime e sha di `config.json` uguali, nessun file della home ne' il plist cambiato, stesso pid del daemon. La home non e' un repo git: al posto di `git status` c'e' l'istantanea di mtime e dimensione di ogni file |
| 7. Token passato con una pipe | PASS | `logs/a5-token.txt`: 0 occorrenze nell'output, in `config.json`, nei 3 file della home, nel plist e in `launchctl print`. Il Portachiavi di prova contiene il valore giusto |
| 8. `gh` non autenticato (`GH_CONFIG_DIR` vuoto) | PASS | `logs/a5-gh.txt`: in un terminale (expect) setup avvia `gh auth login` e resta fermo 38 s senza passi successivi. Quando `gh` esce senza login, stampa `manca  gh autenticato: gh auth login` ed esce con 1. `config.json` non scritto |
| 9. `--repo` non valido | PASS | `logs/a5-repo.txt`: `bad repo "not-a-repo", expected owner/name`, lo stesso testo di `loadConfig`. Nessuna home, plist o voce del Portachiavi |
| 10. Prima issue dopo setup | PASS, testo al posto del PNG | `logs/a5-prima-issue.txt`: issue #57, presa in carico del router dopo 83 s, PR #61 del bot `lunadelera-ops`, nessun comando dopo setup. Stesso ticket della testa nella lane 1, per stare nei 2 ticket completi. Niente PNG: il Chrome di chrome-devtools non ha la sessione GitHub e il repo e' privato |

Le PR #61 e #63 hanno la verifica indipendente (opus) e sono state unite sul repo di prova. Le issue #57 e
#59 si sono chiuse con la PR.

Le lane le ha eseguite l'owner della PR, non dieci worker della swarm. La revisione indipendente resta da
fare.

## Perf

Misurato sulla home di prova pronta (lane 2), 10 esecuzioni di fila.

- `node src/cli.ts doctor` diretto: mediana 814 ms (da 768 a 1343 ms, la prima e' la piu' lenta).
- Con il caricamento di `nvm.sh` nello script della lane: mediana 1195 ms (da 1104 a 2238 ms).
- Cosa limita il numero: la sonda piu' lenta, `atomic auth check` (661 ms), piu' l'avvio di `cli.ts`
  (98 ms). Le altre sonde costano 548 ms (`gh auth status`, rete) e 186 ms (`claude auth status`). In fila
  sarebbero circa 1,5 s: la mediana di 814 ms mostra che le sonde girano insieme.
- Soglia 3 s: rispettata.

Tempo di Vlad da una home vuota alla prima PR, su un Mac con i prerequisiti gia' presenti. Testa: 1
comando, e in modo interattivo 3 risposte (repo, login autorizzati, token). Trunk (`HANDOFF.md` §4): 5
comandi piu' una modifica a mano di `config.json`, e nessun passo scritto per Atomic, pstack o i login.

## Revisione

`media/a5-review-setup.script` e' la registrazione di `script -r` di un `harness setup` interattivo su una
home vuota (domande, token senza eco, dieci passi, `doctor`). Si guarda con
`script -p media/a5-review-setup.script`. `script -r` registra anche i tasti, quindi anche il token:
`strip-input.mjs` toglie i 43 record di input, e il file finale contiene il token 0 volte (contato con
`grep -c`). Niente mp4 e niente PNG: nessun registratore di terminale installato, e `screencapture` qui
non funziona (A1).

## Pulizia

Servizi `i1`, `i1t`, `i5`, `i7`, `i11` tolti con `service uninstall`. Nessun plist `it.delera.harness.i*`
resta. Voci di prova del Portachiavi cancellate, la voce `harness-bot-github` e' intatta. Worktree di
trunk rimosso. Le home in `/tmp/swarm-a5` sono state cancellate dopo la copia delle catture.

## Aperti

- Atomic 0.9.64. Il Mac di Vlad ha 0.9.64 dal 02/11 alle 14:11, dopo il piano. `doctor` accetta 0.9.x da
  0.9.63 in su e `setup` installa 0.9.63 solo se Atomic manca. Con un vincolo esatto `doctor` fallirebbe
  sul Mac che funziona. Da decidere se serve un vincolo esatto.
- Modo `auto` sulle home nuove. E' una scelta mia per far passare la lane 10 senza `harness policy auto`.
  Vlad puo' volere che una home nuova parta in `observe`.
- Il comando di clone di pstack fallisce se la radice esiste gia' e non e' vuota (come nella lane 4).
- `node tools/check-publish.mjs` segnala 16 percorsi di home in `design/mvp/e2e/a1/logs/fix2/`, arrivati
  con la base `6e9beeb`. I file di A5 non ne aggiungono.
- I login interattivi di `atomic` e `claude` non sono stati provati, perche' erano gia' fatti. E' provato
  solo `gh auth login` (lane 8).
- Non c'e' ancora un comando `harness` nel `PATH`: si lancia `node src/cli.ts`. Il README e' di A6.
- `parseConfig` e' il vecchio corpo di `loadConfig`: una modifica di A2 o A3 a quel corpo andra' in
  conflitto e si risolve spostandola in `parseConfig`.

## Correzioni dopo la verifica indipendente (02/11)

Il verificatore ha trovato cinque problemi in `setup` e `doctor` (catture in `/tmp/swarm-a5v/`). Ogni
correzione ha un test che fallisce sul `setup.ts` di prima. Sul codice vecchio i test nuovi danno 80 pass
e 8 fail, sul codice nuovo 88 pass e 0 fail. Le prove dal vivo girano su questo Mac con un banco finto
(`logs/fix1/rig.sh`): un `node` collegato con un hardlink, `npm`, `atomic`, `gh`, `claude`, `security` e
`launchctl` finti, `git` e `stty` veri, un terminale vero tramite `expect`. Nessun login vero, nessuna voce
vera del Portachiavi, nessun servizio vero e nessun prefisso npm vero sono stati toccati.

- Clone di pstack. Con `mkdir -p <radice>/plugins/pstack` il comando stampato e `setup` uscivano con
  codice 128. Ora una radice che contiene solo cartelle vuote viene svuotata e il clone ci entra.
  `doctor` stampa `find <radice> -depth -type d -empty -delete && git clone ...`, e quel comando esce
  con 0. Una radice con un file viene rifiutata con un messaggio, e niente viene clonato o cancellato.
  Prova in `logs/fix1/a5fix-pstack.txt` (`p1.sh`), con un clone vero da GitHub.
- Atomic. Con Atomic 0.9.64 fuori dal `PATH`, oppure con 0.10.0, `setup` lanciava
  `npm i -g @bastani/atomic@0.9.63`. Ora `setup` installa 0.9.63 solo se Atomic manca o e' piu' vecchio
  di 0.9.63. Scelta: `doctor` accetta ancora 0.9.x da 0.9.63 in su. Un Atomic accettato ma fuori dal
  `PATH` riceve il comando `export PATH=...` con la cartella dove si trova. Un Atomic piu' nuovo (0.10.x
  o oltre) viene segnalato e lasciato com'e', con il comando per tornare a 0.9.63 se Vlad lo vuole.
  Prova in `logs/fix1/a5fix-atomic.txt` (`p2.sh`): prima 2 chiamate a npm, dopo 0.
- Eco del token. Il prompt veniva scritto prima di `stty -echo`. Con `expect` che manda il token appena
  vede il prompt, prima il token compariva in 5 prove su 5, dopo in 0 su 5. Ctrl-C al prompt esce con
  130 e lascia l'eco acceso (`stty -a` dopo l'uscita mostra `echo`). Prova in `logs/fix1/a5fix-tty.txt`
  (`tty.exp`, `tty-int2.exp`).
- Ambiente di `doctor`. Le sonde di `atomic`, `claude`, `gh` e `security` girano ora con `daemonEnv`,
  lo stesso ambiente del servizio. Con un `GH_TOKEN` presente solo nella shell, prima `doctor` diceva
  `ok`, ora dice `manca  gh autenticato: gh auth login`. Prova in `logs/fix1/a5fix-doctor-env.txt`.
- `--mode observe|auto`. `setup` lo accetta anche con `--yes`. Decisione di Vlad: una home nuova parte in
  `observe`, e `--mode auto` accende `auto`. Questo sostituisce la scelta di `auto` scritta sopra. Su una
  home esistente `--mode` cambia il modo solo se e' diverso. Prova in `logs/fix1/a5fix-mode.txt`
  (`p5.sh`): prima `--mode` veniva rifiutato, dopo i tre casi danno `observe`, `observe` e `auto`.

Gitleaks 8.30.1 segnalava come `generic-api-key` il token finto del test in `4b5d14c`. Il valore e' ora
`fake_token_for_tests`, anche nella storia del ramo (riscritta con `git rebase --autosquash`, niente era
pubblicato). `gitleaks git --log-opts="65c6d9a..HEAD"` non trova niente.

Aperti. Un login fatto in una shell con `GH_CONFIG_DIR` diverso da quello del servizio ora fa ripetere a
`setup` il comando di login: e' corretto per il servizio, ma il messaggio non spiega il motivo. Il
risultato `want` di `wanted` usa `undefined` per dire "nessun cambio a config.json", senza un tipo con un
nome. I percorsi nei comandi stampati non sono tra virgolette, quindi una cartella con spazi li rompe.
