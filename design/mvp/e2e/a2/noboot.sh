#!/bin/zsh
# noboot.sh: il daemon fermato prima del primo battito (riproduzione del verificatore, a2-noboot). Home
# /tmp/swarm-a2f/t3/home, etichetta it.delera.harness.t3, nessun ticket, checkout /tmp/swarm-a2f/repo.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2f/t3/home
L=it.delera.harness.t3
mkdir -p $HARNESS_HOME
cd /tmp/swarm-a2f/repo/harness
t() { date -u +%H:%M:%SZ }
node src/cli.ts init --repo uppifyagency/harness-sandbox --allow uppifyagency --force >/dev/null
node -e 'const f=process.env.HARNESS_HOME+"/config.json",c=JSON.parse(require("fs").readFileSync(f,"utf8"));c.handles=["/harness-t3"];c.serviceLabel="it.delera.harness.t3";require("fs").writeFileSync(f,JSON.stringify(c,null,2)+"\n")'
node src/cli.ts service install
until [[ -f $HARNESS_HOME/heartbeat.json ]]; do sleep 1; done
echo "$(t) primo daemon: $(cat $HARNESS_HOME/heartbeat.json)"
old=$(launchctl print gui/$UID/$L | awk '/^\tpid =/{print $3}')
launchctl kickstart -k gui/$UID/$L
until new=$(pgrep -f "/tmp/swarm-a2f/repo/harness/src/cli.ts run" | grep -v "^$old$" | head -1) && [[ -n $new ]]; do :; done
kill -STOP $new
echo "$(t) kickstart -k: pid nuovo $new fermato con STOP. Il battito nomina ancora: $(node -e 'process.stdout.write(String(require(process.argv[1]).pid))' $HARNESS_HOME/heartbeat.json)"
ps -o pid,stat,etime,command -p $new | cut -c1-120
until [[ $(launchctl print gui/$UID/$L | awk '/^\tpid =/{print $3}') != $new ]]; do
  sleep 20
  echo "$(t) ps $(ps -o stat=,etime= -p $new | tr -s ' ') | harness: $(node src/cli.ts attention | grep DAEMON || echo '(niente)')"
done
echo "$(t) pid nuovo: $(launchctl print gui/$UID/$L | awk '/^\tpid =/{print $3}')"
until [[ $(node -e 'process.stdout.write(String(require(process.argv[1]).pid))' $HARNESS_HOME/heartbeat.json) != $old ]]; do sleep 2; done
echo "$(t) battito del pid nuovo: $(cat $HARNESS_HOME/heartbeat.json)"
echo "--- watchdog.log"; cat $HARNESS_HOME/logs/watchdog.log
echo "--- launchctl"; launchctl print gui/$UID/$L | grep -E "pid =|runs =|last terminating signal"
ps -o pid,stat -p $new || echo "pid $new non c'e' piu'"
echo "--- harness dopo"; node src/cli.ts attention | grep DAEMON || echo '(nessuna riga DAEMON)'
node src/cli.ts service uninstall
