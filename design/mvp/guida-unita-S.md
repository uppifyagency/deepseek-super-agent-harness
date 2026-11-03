# Unita' S: utente `harness` e account GitHub bot

Perche': l'E2E del 02/11 ha mostrato che un worker che gira con l'utente di Vlad legge il suo
Portachiavi, il PAT GitHub e il login di Atomic (`e2e/method/REPORT.md`, M3). Con un utente macOS
separato e un account bot, un worker che sfugge al guard puo' usare al massimo i permessi del bot sui
repo a cui il bot ha accesso.

Tempo stimato: 20-30 minuti. I passi 1, 2 e 3 richiedono te (browser, password, login).

## 1. Account GitHub bot

1. Esci da GitHub (o usa una finestra anonima) e crea un account nuovo, per esempio
   `uppify-harness`. Serve un'email diversa da quella del tuo account.
2. Attiva la verifica in due passaggi.
3. Dal tuo account `uppifyagency`: `harness-sandbox` > Settings > Collaborators > invita
   `uppify-harness` con ruolo **Write**. Accetta l'invito dall'account bot.
4. Dall'account bot crea un token **classic** con scope `repo` (Settings > Developer settings >
   Personal access tokens > Tokens (classic)). Scadenza: 90 giorni.

   Un token fine-grained non funziona qui: puo' accedere solo ai repo del proprio proprietario o di
   un'organizzazione, non a quelli di un altro account personale. Il token classic e' accettabile
   perche' il bot vede solo i repo a cui lo inviti tu.

## 2. Utente macOS `harness`

Impostazioni di Sistema > Utenti e gruppi > Aggiungi utente:
- tipo **Standard** (non amministratore);
- nome completo `Harness`, nome account `harness`;
- una password lunga, da salvare nel tuo gestore di password.

## 3. Login dentro l'utente `harness`

Entra una volta come `harness`, con Cambio utente rapido. Poi, nel Terminale di quell'utente:

```bash
# Node 26.13.0 con nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.zshrc && nvm install 26.13.0 && nvm alias default 26.13.0

# Atomic 0.9.63, login Codex per Sol
npm i -g @bastani/atomic@0.9.63
atomic            # poi /login e scegli OpenAI Codex, poi /quit

# Claude Code, login con il tuo account (router e verificatore usano il tuo piano)
npm i -g @anthropic-ai/claude-code
claude            # completa il login, poi /exit

# GitHub come bot: incolla il token del passo 1.4
gh auth login --with-token     # (installa gh con Homebrew se manca)
gh auth status                 # deve dire: Logged in as uppify-harness
```

Non installare il bridge di atomic-remote in modo globale per questo utente.

## 4. Il tuo PAT in chiaro (decisione tua, consigliato)

`GITHUB_PERSONAL_ACCESS_TOKEN` e' nel profilo della shell, quindi ogni processo avviato da una tua shell
lo eredita. Il 02/11 non era nell'ambiente di launchd (`launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN`
vuoto, misurato). Se nessun server MCP ne dipende:

```bash
launchctl getenv GITHUB_PERSONAL_ACCESS_TOKEN   # se stampa qualcosa: launchctl unsetenv GITHUB_PERSONAL_ACCESS_TOKEN
# togli quella riga dal profilo della shell, o sostituiscila con una lettura dal Portachiavi:
# export GITHUB_PERSONAL_ACCESS_TOKEN=$(security find-generic-password -s github-pat -w)
```

## 5. Quando hai finito

Dimmelo. Rifaccio la prova M3 come utente `harness`:
- il Portachiavi di Vlad non e' leggibile;
- `~<utente>/.atomic/agent/auth.json` non e' leggibile;
- nell'ambiente non c'e' nessun `*_TOKEN`;
- un push su un repo dove il bot non e' collaboratore viene rifiutato da GitHub.

Poi preparo il plist di launchd e passo all'unita' 4.
