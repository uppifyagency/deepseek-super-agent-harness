#!/bin/zsh
# kill-watchdog.sh: lane 5 on home w2. Once the run is stalled, start a watchdog check, kill -9 it while its
# judge runs, then let launchd's next check judge; record the events (one verdict, one stop, one end).
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-2/home W=it.delera.harness.watchdog.w2
cd "$HOME/Desktop/PROGETTI ANTYGRAVITY/Super-Agent-Harness-a2/harness"
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
t() { date -u +%H:%M:%SZ }
until RUN=$(q "select json_extract(draft,'\$.body.run') from event where kind='run.bound' and seq > ${1:-0} order by seq desc limit 1") && [[ -n $RUN ]]; do sleep 2; done
echo "$(t) run $RUN"
until node -e "process.exit(Date.now() - Date.parse(process.argv[1]) > 190000 ? 0 : 1)" "$(q "select at from event where kind='run.bound' and json_extract(draft,'\$.body.run')='$RUN'")"; do sleep 2; done
[[ -n $(q "select 1 from event where kind='watchdog.judged' and json_extract(draft,'\$.body.run')='$RUN'") ]] && { echo "$(t) already judged by the schedule, nothing to kill"; exit 1; }
echo "$(t) kickstart $W"; launchctl kickstart gui/$UID/$W
until pid=$(launchctl print gui/$UID/$W | awk '/^\tpid =/{print $3}') && [[ -n $pid ]] && pgrep -P $pid >/dev/null; do sleep 0.2; done
echo "$(t) watchdog pid $pid judging (child $(pgrep -P $pid | tr '\n' ' '))"; kill -9 $pid; echo "$(t) kill -9 $pid"
sleep 1; echo "$(t) after kill: $(launchctl print gui/$UID/$W | grep -E '^\s*(state|pid|last terminating signal) =' | tr -s '\t\n' ' ')"
echo "$(t) judged so far: $(q "select count(*) from event where kind='watchdog.judged'")"
until [[ -n $(q "select 1 from event where kind='run.ended' and json_extract(draft,'\$.body.run')='$RUN'") ]]; do sleep 3; done
echo "$(t) run.ended"
echo "--- events of the run"; q "select seq,at,kind,substr(json_extract(draft,'\$.body'),1,200) from event where kind in ('run.bound','watchdog.judged','stop.intended','run.ended') and json_extract(draft,'\$.body.run')='$RUN'"
echo "--- counts"; q "select kind,count(*) from event where json_extract(draft,'\$.body.run')='$RUN' and kind in ('watchdog.judged','stop.intended','run.ended') group by kind"
echo "--- watchdog.log"; tail -5 $HARNESS_HOME/logs/watchdog.log
echo "--- engine.log"; tail -4 $HARNESS_HOME/logs/engine.log
echo "--- harness"; node src/cli.ts
