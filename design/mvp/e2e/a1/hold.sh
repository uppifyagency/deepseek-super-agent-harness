#!/bin/zsh
# hold.sh <label> <home> [tries]: raw `launchctl bootout; launchctl bootstrap` back to back on a loaded
# agent, then how long launchd takes to forget the label. Leaves the agent loaded.
set -u
label=$1 home=$2 tries=${3:-3}
plist=~/Library/LaunchAgents/$label.plist
now() { perl -MTime::HiRes=time -e 'printf "%.1f", time' }
running() { launchctl print gui/$UID/$label 2>/dev/null | awk '/^\tpid =/{print $3}' }
for i in $(seq $tries); do
  until [[ -n $(running) && -f $home/heartbeat.json ]]; do sleep 1; done
  pid=$(running)
  echo "--- try $i $(date +%T) pid $pid"
  t0=$(now)
  launchctl bootout gui/$UID/$label; echo "bootout exit=$?"
  launchctl bootstrap gui/$UID $plist; echo "bootstrap exit=$?"
  until launchctl print gui/$UID/$label >/dev/null 2>&1; [[ $? == 113 ]]; do sleep 0.1; done
  printf "label forgotten %.1f s after bootout" $(( $(now) - t0 )); echo "; pid $pid alive: $(kill -0 $pid 2>/dev/null && echo yes || echo no)"
  rm -f $home/heartbeat.json
  launchctl bootstrap gui/$UID $plist; echo "bootstrap after teardown exit=$?"
done
grep 'engine disposed' $home/logs/engine.log | tail -n $tries
