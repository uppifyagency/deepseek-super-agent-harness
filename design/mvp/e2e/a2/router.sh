#!/bin/zsh
# router.sh: lane 7 on home w7. 1) the daemon's PATH has no claude for 5 minutes; 2) a claude that takes 330 s
# per turn (a long, healthy router turn); then the router works again. Issue number in $1.
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-7/home L=it.delera.harness.w7
cd "$HOME/Desktop/PROGETTI ANTYGRAVITY/Super-Agent-Harness-a2/harness"
E=../design/mvp/e2e/a2
t() { date -u +%H:%M:%SZ }
NODEBIN=$(dirname $(which node))
BASE=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
node src/cli.ts service install --every 60
echo "$(t) daemon PATH without claude: $NODEBIN:$BASE"
node $E/install-path.ts "$NODEBIN:$BASE"
sleep 300
echo "$(t) after 5 minutes without claude"
echo "--- harness (attention)"; node src/cli.ts
echo "--- router-runs.jsonl"; tail -6 $HARNESS_HOME/router-runs.jsonl | cut -c1-220
echo "$(t) daemon PATH with a claude that sleeps 330 s before each turn"
node $E/install-path.ts "$NODEBIN:/tmp/swarm-a2/slowbin:$HOME/.local/bin:$BASE"
until grep -q '"ok":true' $HARNESS_HOME/router-runs.jsonl; do sleep 5; done
echo "$(t) first router turn that worked"
sleep 70
echo "--- harness (attention)"; node src/cli.ts
echo "--- router-runs.jsonl"; tail -3 $HARNESS_HOME/router-runs.jsonl | cut -c1-220
echo "--- watchdog.log"; cat $HARNESS_HOME/logs/watchdog.log
echo "--- launchctl print"; launchctl print gui/$UID/$L | grep -E '^\s*(state|pid|runs|last exit code) ='
