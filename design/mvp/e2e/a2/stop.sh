#!/bin/zsh
# stop.sh <n> <checkout> <wait-s>: install the lane's service, SIGSTOP the daemon once it beats, then watch for <wait-s>.
set -u
n=$1 checkout=$2 wait=$3
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-$n/home L=it.delera.harness.w$n
cd "$checkout/harness"
t() { date -u +%H:%M:%SZ }
node src/cli.ts service install --every 60
until [[ -f $HARNESS_HOME/heartbeat.json ]]; do sleep 1; done
pid=$(launchctl print gui/$UID/$L | awk '/^\tpid =/{print $3}')
echo "$(t) heartbeat $(cat $HARNESS_HOME/heartbeat.json)"
echo "$(t) kill -STOP $pid"; kill -STOP $pid
t0=$(date +%s)
while (( $(date +%s) - t0 < wait )); do
  now=$(launchctl print gui/$UID/$L 2>/dev/null | awk '/^\tpid =/{print $3}')
  if [[ -n $now && $now != $pid ]] && grep -q "\"pid\":$now" $HARNESS_HOME/heartbeat.json; then
    echo "$(t) new pid $now beating after $(( $(date +%s) - t0 )) s: $(cat $HARNESS_HOME/heartbeat.json)"; break
  fi
  sleep 2
done
echo "$(t) after $(( $(date +%s) - t0 )) s: old pid $pid state=$(ps -o state= -p $pid 2>/dev/null || echo gone)"
node src/cli.ts service status
echo "--- watchdog.log"; cat $HARNESS_HOME/logs/watchdog.log 2>/dev/null || echo "(none: no watchdog on this checkout)"
echo "--- launchctl print"; launchctl print gui/$UID/$L | grep -E '^\s*(state|pid|runs|last exit code|last terminating signal) ='
