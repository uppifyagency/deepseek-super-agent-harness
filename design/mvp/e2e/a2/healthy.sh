#!/bin/zsh
# healthy.sh: lane 3 on home w3. A 20-minute test with output; `service restart` 3 s into verify (the A1 box);
# record verdicts, attempts and the PR.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-3/home
cd /tmp/swarm-a2/repo/harness
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
t() { date -u +%H:%M:%SZ }
until [[ -n $(q "select 1 from event where kind='run.progress' and json_extract(draft,'\$.body.stage')='verify' and seq > $1 limit 1") ]]; do sleep 1; done
sleep 3
echo "$(t) service restart, 3 s into verify"; node src/cli.ts service restart
until [[ -n $(q "select 1 from event where kind='run.ended' and seq > $1 limit 1") ]]; do sleep 5; done
sleep 20
echo "$(t) run.ended"
echo "--- run events"; q "select seq,at,kind,substr(json_extract(draft,'\$.body'),1,260) from event where kind in ('run.intended','run.bound','run.progress','watchdog.judged','stop.intended','run.ended')"
echo "--- attempts: $(q "select count(*) from event where seq > $1 and kind='run.intended'")  ended: $(q "select count(*) from event where seq > $1 and kind='run.ended'")  stops: $(q "select count(*) from event where seq > $1 and kind='stop.intended'")"
echo "--- watchdog.log"; cat $HARNESS_HOME/logs/watchdog.log
echo "--- engine.log"; cat $HARNESS_HOME/logs/engine.log | grep -vE 'continuation' | tail -15
