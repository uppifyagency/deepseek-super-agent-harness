#!/bin/zsh
# home.sh <n> <checkout>: the integration home /tmp/swarm-int/m<n>/home on harness-sandbox, label it.delera.harness.m<n>,
# handle /harness-m<n>, candidates with speculative on and candidateMatch "[m<n>]", stuckAfterMin 2, auto, one worker.
set -eu
n=$1 checkout=$2
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 26.13.0 >/dev/null
export HARNESS_HOME=/tmp/swarm-int/m$n/home
mkdir -p $HARNESS_HOME
cd "$checkout/harness"
node src/cli.ts init --repo uppifyagency/harness-sandbox:candidates --allow uppifyagency --force >/dev/null
node -e '
const n = process.argv[1], f = process.env.HARNESS_HOME + "/config.json", c = JSON.parse(require("fs").readFileSync(f, "utf8"))
c.handles = ["/harness-m" + n]; c.serviceLabel = "it.delera.harness.m" + n; c.stuckAfterMin = 2
Object.assign(c.repos[0], { speculative: { enabled: true }, candidateMatch: "\\[m" + n + "\\]" })
require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n")' "$n"
node src/cli.ts policy auto --workers 1 >/dev/null
echo "$HARNESS_HOME"
