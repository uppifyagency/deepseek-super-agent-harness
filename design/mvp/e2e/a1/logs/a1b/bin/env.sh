export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 26.13.0 >/dev/null
export HARNESS_HOME=/tmp/swarm-a1b/home L=it.delera.harness.y1 R=uppifyagency/harness-sandbox W=/tmp/swarm-a1b N=y1
cd "~/Desktop/PROGETTI ANTYGRAVITY/Super-Agent-Harness-a1b/harness"
q() { sqlite3 $HARNESS_HOME/log.sqlite "$1" }
ts() { date -u +%TZ }
