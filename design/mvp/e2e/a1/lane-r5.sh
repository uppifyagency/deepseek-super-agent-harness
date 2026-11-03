#!/bin/zsh
# lane-r4.sh: service restart 8 s after run.bound (no checkpoint yet), then 3 s into verify; capture both.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a1r/worker-5/home; L=it.delera.harness.r5; cd /tmp/swarm-a1r/repo/harness
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
out=/tmp/swarm-a1r/worker-5/a1-kickstart-r5.txt
snap() { echo "\$ $(date -u +%TZ) $1"; }
until [[ -n $(q "select 1 from event where kind='run.bound' limit 1") ]]; do sleep 1; done
sleep 2
{ snap "restart 1, 2 s after run.bound (before the first checkpoint)"; q "select at,kind from event where kind like 'run.%' order by seq"
node src/cli.ts service restart; } >> $out 2>&1
until [[ -n $(q "select 1 from event where kind='run.ended' limit 1") ]]; do sleep 5; done
sleep 30
{ snap "after run.ended"; q "select at,kind,json_extract(draft,'\$.body.run'),json_extract(draft,'\$.body.atomic'),json_extract(draft,'\$.body.attempt'),json_extract(draft,'\$.body.outcome.kind'),json_extract(draft,'\$.body.outcome.url'),json_extract(draft,'\$.body.outcome.evidence') from event where kind like 'run.%' and kind!='run.progress' order by seq"
echo "\$ launchctl print"; launchctl print gui/$UID/$L | grep -E '^\s*(state|pid|runs|last exit code) ='
echo "\$ engine.log"; cat $HARNESS_HOME/logs/engine.log; } >> $out 2>&1
