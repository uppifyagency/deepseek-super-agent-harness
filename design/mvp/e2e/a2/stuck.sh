#!/bin/zsh
# stuck.sh <after-seq>: lanes 2 and 8 on home w2. Once the newest run is stalled (3 min), two checks judge it at
# the same time; then wait for the daemon to stop it and record the chain.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-2/home
cd /tmp/swarm-a2/repo/harness
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
t() { date -u +%H:%M:%SZ }
until RUN=$(q "select json_extract(draft,'\$.body.run') from event where kind='run.bound' and seq > $1 order by seq desc limit 1") && [[ -n $RUN ]]; do sleep 2; done
echo "$(t) run $RUN bound"
until node -e "process.exit(Date.now() - Date.parse(process.argv[1]) > 185000 ? 0 : 1)" "$(q "select at from event where kind='run.bound' and json_extract(draft,'\$.body.run')='$RUN'")"; do sleep 2; done
echo "$(t) two checks at once"
node src/cli.ts watchdog --once > /tmp/swarm-a2/check-a.txt & node src/cli.ts watchdog --once > /tmp/swarm-a2/check-b.txt & wait
echo "check A: $(cat /tmp/swarm-a2/check-a.txt)"; echo "check B: $(cat /tmp/swarm-a2/check-b.txt)"
until [[ -n $(q "select 1 from event where kind='run.ended' and json_extract(draft,'\$.body.run')='$RUN'") ]]; do sleep 2; done
echo "$(t) run.ended"
echo "--- events of the run"; q "select seq,at,kind,json_extract(draft,'\$.body') from event where kind in ('run.bound','run.progress','watchdog.judged','stop.intended','run.ended') and json_extract(draft,'\$.body.run')='$RUN'"
echo "--- counts"; q "select kind,count(*) from event where json_extract(draft,'\$.body.run')='$RUN' and kind in ('watchdog.judged','stop.intended','run.ended') group by kind"
echo "--- watchdog.log"; tail -4 $HARNESS_HOME/logs/watchdog.log
echo "--- engine.log"; tail -3 $HARNESS_HOME/logs/engine.log
echo "--- worker transcript, last entry (the quit stopped it)"; sqlite3 $HARNESS_HOME/atomic/sessions.sqlite "select max(json_extract(e.entry_json,'\$.timestamp')) from session_sessions s join session_entries e on e.session_id=s.id where s.internal=1 and s.modified_at=(select max(modified_at) from session_sessions where internal=1)"
echo "--- Atomic journal"; sqlite3 $HARNESS_HOME/atomic/journal.sqlite "select run_id,status from wf_runs order by created_at desc limit 1"
echo "--- worktrees"; ls $HARNESS_HOME/worktrees
sleep 90
echo "--- harness"; node src/cli.ts
