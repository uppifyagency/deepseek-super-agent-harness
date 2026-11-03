#!/bin/zsh
# prova-h1.sh <n> <file>: H1 scenario B dal vivo, poi uno stop vero, su un solo ticket. Home /tmp/swarm-a2f/t<n>/home,
# etichetta it.delera.harness.t<n>, checkout in /tmp/swarm-a2f/repo. <file> e' quello che il worker aspetta al passo 1. Il daemon gira con giri
# di 300 s e i controlli del watchdog si lanciano a mano, appena dopo un giro: tra il giudizio e il giro dopo
# c'e' il tempo di aprire e rispondere il gate.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2f/t$1/home
GO=$2
cd /tmp/swarm-a2f/repo/harness
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
t() { date -u +%H:%M:%SZ }
tick() { node -e 'process.stdout.write(String(require(process.argv[1]).tick))' $HARNESS_HOME/heartbeat.json }
lap_end() { local n=$(tick); until [[ $(tick) -gt $n ]]; do sleep 2; done }   # a lap just ended: the next starts in 300 s
until RUN=$(q "select json_extract(draft,'\$.body.run') from event where kind='run.bound' order by seq desc limit 1") && [[ -n $RUN ]]; do sleep 5; done
echo "$(t) run $RUN bound"
judged() { q "select count(*) from event where kind='watchdog.judged' and json_extract(draft,'\$.body.run')='$RUN' and json_extract(draft,'\$.body.verdict')='stuck'" }
n0=$(judged)
until [[ $(judged) -gt $n0 ]]; do lap_end; echo "$(t) giro finito, controllo: $(node src/cli.ts watchdog --once)"; done
echo "$(t) primo giudizio stuck. Sblocco il worker: $GO"
touch $GO
until GATE=$(q "select json_extract(draft,'\$.body.gate') from event where kind='gate.opened' and json_extract(draft,'\$.body.run')='$RUN' order by seq desc limit 1") && [[ -n $GATE ]]; do sleep 2; done
echo "$(t) gate $GATE aperto"
echo "$(t) risposta: $(node src/cli.ts answer $GATE NOTE-B)"
echo "$(t) aspetto il giro dopo"
lap_end
echo "$(t) giro finito. stop.intended del run: $(q "select count(*) from event where kind='stop.intended' and json_extract(draft,'\$.body.run')='$RUN'"), run.ended: $(q "select count(*) from event where kind='run.ended' and json_extract(draft,'\$.body.run')='$RUN'")"
echo "$(t) ora il worker gira in tondo: secondo giudizio"
n1=$(judged)
until [[ $(judged) -gt $n1 ]]; do lap_end; echo "$(t) giro finito, controllo: $(node src/cli.ts watchdog --once)"; done
echo "$(t) secondo giudizio stuck, aspetto lo stop"
until [[ -n $(q "select 1 from event where kind='run.ended' and json_extract(draft,'\$.body.run')='$RUN'") ]]; do sleep 5; done
echo "$(t) run.ended"
echo "--- eventi del run"; q "select seq,at,kind,substr(json_extract(draft,'\$.body'),1,260) from event where (json_extract(draft,'\$.body.run')='$RUN' and kind in ('run.bound','run.progress','watchdog.judged','stop.intended','gate.opened','run.ended')) or (kind='gate.answered' and json_extract(draft,'\$.body.gate')='$GATE') order by seq"
echo "--- conteggi"; q "select kind,count(*) from event where json_extract(draft,'\$.body.run')='$RUN' and kind in ('watchdog.judged','stop.intended','run.ended') group by kind"
echo "--- watchdog.log"; tail -8 $HARNESS_HOME/logs/watchdog.log
echo "--- engine.log"; grep -E "stop|gate|quit" $HARNESS_HOME/logs/engine.log | tail -6
echo "--- worktree"; ls $HARNESS_HOME/worktrees
echo "--- harness"; node src/cli.ts
