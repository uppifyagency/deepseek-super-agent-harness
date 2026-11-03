#!/bin/zsh
# A1b: --every 20, one ticket, service restart at run.bound+2 s, then 10 s after the new process takes the run back
set -u
. /tmp/swarm-a1b/bin/env.sh; . /tmp/swarm-a1b/bin/common.sh
out=$W/a1b-kickstart.txt
{ mkdir -p $HARNESS_HOME
node src/cli.ts init --repo $R --allow uppifyagency >/dev/null
node -e 'const f=process.env.HARNESS_HOME+"/config.json",c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.handles=["/harness-y1"];c.serviceLabel="it.delera.harness.y1";require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
node src/cli.ts policy auto --workers 1 >/dev/null
cat $HARNESS_HOME/config.json
echo "\$ $(ts) service install --every 20"; node src/cli.ts service install --every 20
until [[ -n $(pid) ]]; do sleep 0.5; done
until [[ -s $HARNESS_HOME/run.lock ]]; do sleep 0.5; done
echo "\$ $(ts) harness work while the service (pid $(pid)) holds the lock"; node src/cli.ts work; echo "exit code: $?"
ticket
until [[ -n $(q "select 1 from event where kind='run.bound' limit 1") ]]; do sleep 0.5; done
echo "\$ $(ts) first run.bound: $(q "select at from event where kind='run.bound' limit 1")"
sleep 2; rs
n0=$(wc -l < $HARNESS_HOME/logs/engine.log)
until (( $(wc -l < $HARNESS_HOME/logs/engine.log) > n0 )) && tail -n +$((n0+1)) $HARNESS_HOME/logs/engine.log | grep -q -E 'resume|bound'; do sleep 0.5; done
echo "\$ $(ts) new process took the run back: $(tail -n +$((n0+1)) $HARNESS_HOME/logs/engine.log | grep -E 'resume|bound' | head -1 | cut -c1-200)"
sleep 10; rs
t0=$(date +%s)
finish 1800
echo "\$ $(ts) finished waiting after $(( $(date +%s) - t0 )) s from second restart"
report
echo "\$ bridge records of every Atomic run bound to this ticket"
for a in $(q "select json_extract(draft,'\$.body.atomic') from event where kind='run.bound'"); do
  echo "# $a"; grep -l "$a" ~/.atomic/agent/remote-bridge/*/meta.json 2>/dev/null | while read f; do echo "$f"; node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(JSON.stringify({status:m.status,enginePid:m.enginePid,closeReason:m.closeReason,pendingRuns:m.pendingRuns.map(r=>r.runId)}))' "$f"; done
done; } > $out 2>&1
