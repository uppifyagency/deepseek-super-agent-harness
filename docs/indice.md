# Super-Agent-Harness: indice del progetto

Indice in italiano per chi lavora sul progetto. Il README pubblico in inglese e' [`../README.md`](../README.md). I percorsi qui sotto partono dalla radice del repo; `riferimenti/` e `harness-home-sandbox/` restano solo sul Mac di Vlad e non sono nel repo.

Progetto per costruire un harness di "super agent": un servizio che ascolta, decide se lavorare,
fa girare il lavoro in modo durevole e lo verifica prima di dire "fatto".

Creato il 02/11/2026. Il codice sta in `harness/`, il progetto in `design/mvp/`.

## Cosa c'e'

| Percorso | Cosa | Versione |
|---|---|---|
| `HANDOFF.md` | **Da leggere per primo** se riprendi il lavoro: stato, decisioni, fatti verificati, prossimi passi | 02/11 |
| `harness-home-sandbox/` | Home dell'harness usata per le prove su `harness-sandbox` (`HARNESS_HOME`) | 02/11 |
| `riferimenti/atomic-remote/` | Clone del plugin atomic-remote, branch `atomic-0.9.63-compat` (0.3.2, non pubblicato) | 02/11 |
| `harness/` | **Il codice.** Node 26, TypeScript senza build. Unita' 1-3 fatte: registro, fonte GitHub e filtro, router su Claude Code con MCP, risposte. `npm test`, CLI `node src/cli.ts` | 02/11 |
| `design/mvp/` | **Progetto dell'MVP** (02/11, seconda iterazione): `rationale.md`, `build-plan.md`, `usage.md`, `src/*.ts`, i 3 candidati | 02/11 |
| `design/` | Prima iterazione: forma dei tipi da `/pstack:architect`: `rationale.md`, `usage.md`, `src/*.ts` (tsc --strict ok), i 3 candidati e il grounding | 02/11 |
| `mappa-dsh-pstack-atomic.md` | dsh-superagent mappato concetto per concetto su pstack e Atomic | Atomic al 29/08: da riallineare alla 0.9.63 |
| `riferimenti/dsh-superagent/repo/` | Il nostro fork `uppifyagency/dsh-superagent-prototype`, remote `upstream` = `deepseek-ai/dsh-superagent-prototype` | `6337fc8` (31/10), uguale a upstream |
| `riferimenti/dsh-superagent/deepwiki/` | DeepWiki di `deepseek-ai/dsh-superagent-prototype` | 38 pagine, export 02/11 |
| `riferimenti/dsh-superagent/analisi/` | Lettura completa di documenti, prompt (`dsh-docs.md`) e codice (`dsh-code.md`), con file:riga | 02/11 |
| `riferimenti/dsh-superagent/articolo/` | Articolo completo "Exploring Super-agent Design" (DeepSeek, 01/11) in markdown, 13 immagini, JSON originale | scaricato 02/11 via api.fxtwitter.com |
| `riferimenti/dsh-superagent/diagrammi/` | 9 diagrammi dell'articolo con note su cosa cambiano per i tipi | 02/11 |
| `riferimenti/pstack/deepwiki/` | DeepWiki di `michael-denyer/pstack-claude` (il port che usiamo) | 37 pagine, export 02/11 |
| `riferimenti/pstack/feature-map.md` | Tutti i comandi, playbook, principi, ruoli e script | plugin 0.9.117, `8ecae68` |
| `riferimenti/atomic/deepwiki/` | DeepWiki di `bastani-inc/atomic` | 55 pagine, export 02/11 |
| `riferimenti/atomic/feature-map.md` | Feature map dal sorgente | release 0.9.63, `c0e8e08` |
| `riferimenti/tools/` | `export-deepwiki-mcp.sh` per riesportare una DeepWiki | |

Sorgenti completi fuori da questa cartella: Atomic 0.9.63 in `~/src/ext/atomic-0.9.63`,
pstack in `~/src/pstack-claude` (aggiornato ogni giorno da `~/bin/pstack-update.sh`).

## Riallineare

```bash
riferimenti/tools/export-deepwiki-mcp.sh bastani-inc/atomic riferimenti/atomic/deepwiki Atomic
riferimenti/tools/export-deepwiki-mcp.sh michael-denyer/pstack-claude riferimenti/pstack/deepwiki pstack-claude
riferimenti/tools/export-deepwiki-mcp.sh deepseek-ai/dsh-superagent-prototype riferimenti/dsh-superagent/deepwiki dsh-superagent-prototype
git -C riferimenti/dsh-superagent/repo fetch upstream
```

La DeepWiki non dice quale commit ha indicizzato: per il codice fa fede il repo.
