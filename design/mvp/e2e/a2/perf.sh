#!/bin/zsh
# perf.sh <source home> <run>: 20 `harness watchdog --once`, alternating a home with no run and a copy of <source home>
# rewound to just before the watchdog judged <run> (events from its first watchdog.judged on deleted, views
# rebuilt, worker session cwd moved to the copy). Both get a fresh heartbeat of a dead pid and a label
# nobody installed, so the daemon check is the code path of a beating daemon and nothing is restarted.
set -u
src=$1 run=$2
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
cd /tmp/swarm-a2/repo/harness
P=/tmp/swarm-a2/perf; rm -rf $P; mkdir -p $P/snap/atomic $P/empty
sqlite3 $src/log.sqlite ".backup $P/snap/log.sqlite"; sqlite3 $src/atomic/sessions.sqlite ".backup $P/snap/atomic/sessions.sqlite"
sqlite3 $P/snap/log.sqlite "DELETE FROM event WHERE seq >= (SELECT min(seq) FROM event WHERE kind='watchdog.judged' AND json_extract(draft,'\$.body.run')='$run'); DELETE FROM view; DELETE FROM view_meta;"
sqlite3 $P/snap/atomic/sessions.sqlite "UPDATE session_sessions SET cwd = replace(cwd, '$src', '$P/stuck')"
for h in snap empty; do echo '{"repos":["uppifyagency/harness-sandbox"],"allowedActors":["uppifyagency"],"serviceLabel":"it.delera.harness.wperf","stuckAfterMin":3}' > $P/$h/config.json; done
beat() { echo "{\"pid\":1,\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"tick\":1,\"everyMs\":60000}" > $1/heartbeat.json }
for i in $(seq 1 10); do
  rm -rf $P/stuck; cp -R $P/snap $P/stuck; beat $P/stuck; beat $P/empty
  for h in empty stuck; do
    s=$(python3 -c 'import time;print(time.time())')
    line=$(HARNESS_HOME=$P/$h node src/cli.ts watchdog --once)
    e=$(python3 -c 'import time;print(time.time())')
    echo "$i $h wall=$(python3 -c "print(round($e-$s,2))")s | $line"
  done
done
