#!/bin/zsh
# lane.sh <n> <mode> <stuckAfterMin> [checkout]: a lane home /tmp/swarm-a2/worker-<n>/home on harness-sandbox,
# label it.delera.harness.w<n>, handle /harness-w<n>, one worker. Prints the HARNESS_HOME.
set -eu
n=$1 mode=$2 stuck=$3 checkout=${4:-"$HOME/Desktop/PROGETTI ANTYGRAVITY/Super-Agent-Harness-a2"}
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a2/worker-$n/home
mkdir -p $HARNESS_HOME
cd "$checkout/harness"
node src/cli.ts init --repo uppifyagency/harness-sandbox --allow uppifyagency --force >/dev/null
node -e '
const f = process.env.HARNESS_HOME + "/config.json", c = JSON.parse(require("fs").readFileSync(f, "utf8"))
c.handles = ["/harness-w" + process.argv[1]]; c.serviceLabel = "it.delera.harness.w" + process.argv[1]; c.stuckAfterMin = Number(process.argv[2])
require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n")' "$n" "$stuck"
node src/cli.ts policy $mode --workers 1 >/dev/null
echo "$HARNESS_HOME"
