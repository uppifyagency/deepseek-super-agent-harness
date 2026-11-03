#!/bin/zsh
# stuck-proof.sh <checkout>: one visible issue on harness-sandbox whose worker waits on a file that never comes,
# run by the m1 home from a /tmp clone of HEAD. Prints the run's events once run.ended is written (15 min at most).
set -eu
src=$1
int=/tmp/swarm-int
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 26.13.0 >/dev/null
export HARNESS_HOME=$int/m1/home
rm -rf $int/repo
git clone -q "$src" $int/repo
git -C $int/repo checkout -q "$(git -C "$src" rev-parse HEAD)"
cli=$int/repo/harness/src/cli.ts
node -e 'const f = process.argv[1], c = JSON.parse(require("fs").readFileSync(f, "utf8")); c.botKeychainService = "harness-bot-github-test-int"; require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n")' $HARNESS_HOME/config.json
cd $int/repo/harness
node $cli service install
from=$(sqlite3 $HARNESS_HOME/log.sqlite 'select max(seq) from event')
url=$(gh issue create -R uppifyagency/harness-sandbox --title '[m1] scripts/hello-m1b.sh' \
  --body '/harness-m1 aggiungi scripts/hello-m1b.sh che stampa hello, con un test. Prima di scrivere qualsiasi cosa, esegui `while ! test -f /tmp/swarm-int/via-m1b; do sleep 30; done` e aspetta che finisca.')
print "# Stop del watchdog su un run visibile, $url, head $(git -C $int/repo rev-parse --short HEAD), home $HARNESS_HOME, label it.delera.harness.m1, stuckAfterMin 2"
print "$(date -u +%TZ) issue created, events after seq $from"
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
deadline=$(( $(date +%s) + 900 ))
while [ -z "$(q "select 1 from event where seq > $from and json_extract(draft,'\$.kind') = 'decided'")" ]; do
  [ -n "$(q "select 1 from event where seq > $from and json_extract(draft,'\$.kind') = 'eval.opened'")" ] && node ../design/mvp/e2e/int/decide.ts visible 'hello-m1b script' 'scripts/hello-m1b.sh prints hello, with a test' || true
  sleep 0.3
  [ $(date +%s) -gt $deadline ] && { print "no decision in 15 min"; exit 1 }
done
print "$(date -u +%TZ) decided"
ticket=$(q "select json_extract(draft,'\$.thread.ticket') from event where seq > $from and json_extract(draft,'\$.kind') = 'ticket.opened' and json_extract(draft,'\$.body.title') = 'hello-m1b script'")
ended="seq > $from and json_extract(draft,'\$.kind') = 'run.ended' and json_extract(draft,'\$.body.run') in (select id from event where json_extract(draft,'\$.kind') = 'run.intended' and json_extract(draft,'\$.body.ticket') = '$ticket')"
until [ -n "$(q "select 1 from event where $ended")" ]; do
  sleep 5
  [ $(date +%s) -gt $deadline ] && { print "no run.ended in 15 min"; break }
done
print "$(date -u +%TZ) run.ended of ticket $ticket seen"
sleep 60
print -- "--- events after seq $from"
q "select seq, at, json_extract(draft,'\$.kind'), json_extract(draft,'\$.by'), json_extract(draft,'\$.body') from event where seq > $from and json_extract(draft,'\$.kind') in ('decided','ticket.opened','run.intended','run.bound','watchdog.judged','stop.intended','run.ended','reply.intended','reply.settled') order by seq"
print -- "--- causes of run.ended of ticket $ticket (kinds)"
q "select json_extract(c.draft,'\$.kind') from event e join edge g on g.effect = e.id join event c on c.id = g.cause where e.id in (select id from event where $ended)"
print -- "--- watchdog.log (from the issue)"
awk -v t="$(q "select at from event where seq = $from + 1")" '$1 >= t' $HARNESS_HOME/logs/watchdog.log
print -- "--- engine.log (stop)"
grep ' stop ' $HARNESS_HOME/logs/engine.log | tail -2
print -- "--- harness"
node $cli 2>&1 | grep -E 'STUCK|m1b' || true
print -- "--- service"
node $cli service status
