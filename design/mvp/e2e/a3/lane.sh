#!/bin/zsh
# lane.sh <n> <checkout> [workers] [json patch for the repo entry]: a lane home /tmp/swarm-a3/worker-<n>/home on
# harness-sandbox, handle /harness-s<n>, listen candidates with speculative on, and candidateMatch "[a3-s<n>]" so the
# lane hears only its own issues (other agents share the sandbox). Policy auto. Prints the HARNESS_HOME.
set -eu
n=$1 checkout=$2 workers=${3:-1} patch=${4:-'{}'}
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a3/worker-$n/home
cd "$checkout/harness"
node src/cli.ts init --repo uppifyagency/harness-sandbox:candidates --allow uppifyagency >/dev/null
node -e '
const [n, patch] = process.argv.slice(1)
const f = process.env.HARNESS_HOME + "/config.json", c = JSON.parse(require("fs").readFileSync(f, "utf8"))
c.handles = ["/harness-s" + n]; c.serviceLabel = "it.delera.harness.s" + n
Object.assign(c.repos[0], { speculative: { enabled: true }, candidateMatch: "\\[a3-s" + n + "\\]" }, JSON.parse(patch))
require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n")' "$n" "$patch"
node src/cli.ts policy auto --workers "$workers" >/dev/null
echo "$HARNESS_HOME"
