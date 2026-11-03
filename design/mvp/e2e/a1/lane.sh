#!/bin/zsh
# lane.sh <n> <handle> <checkout> [home]: a lane home (default /tmp/swarm-a1/worker-<n>/home) on harness-sandbox,
# label it.delera.harness.l<n>, policy auto with one worker. Prints the HARNESS_HOME.
set -eu
n=$1 handle=$2 checkout=$3 home=${4:-/tmp/swarm-a1/worker-$1/home}
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=$home
cd "$checkout/harness"
node src/cli.ts init --repo uppifyagency/harness-sandbox --allow uppifyagency >/dev/null
node -e '
const f = process.env.HARNESS_HOME + "/config.json", c = JSON.parse(require("fs").readFileSync(f, "utf8"))
c.handles = [process.argv[1]]; c.serviceLabel = "it.delera.harness.l" + process.argv[2]
require("fs").writeFileSync(f, JSON.stringify(c, null, 2) + "\n")' "$handle" "$n"
node src/cli.ts policy auto --workers 1 >/dev/null
echo "$HARNESS_HOME"
