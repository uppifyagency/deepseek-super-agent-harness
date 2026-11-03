#!/usr/bin/env bash
# Records docs/media/setup.gif and docs/media/ticket.gif with vhs from a checkout under /tmp.
# launchd jobs started from ~/Desktop, ~/Documents or ~/Downloads hung in open(), so the service runs from /tmp.
# Uses a test home, a test Keychain service and a test launchd label, and removes all three on exit.
set -euo pipefail

src=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
work=/tmp/sah-gif
label=it.delera.harness.gif
keychain=harness-bot-github-test-gif
pstack_src=${PSTACK_SRC:-https://github.com/michael-denyer/pstack-claude}

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>26||(a===26&&b>=13)?0:1)' \
  || { echo "record.sh: needs Node >= 26.13.0 on PATH" >&2; exit 1; }

cleanup() {
  [ -d "$work/repo" ] && HARNESS_HOME="$work/home" node "$work/repo/harness/src/cli.ts" service uninstall || true
  security delete-generic-password -s "$keychain" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

rm -rf "$work"
mkdir -p "$work/home"
git clone -q "$src" "$work/repo"
git -C "$work/repo" checkout -q "$(git -C "$src" rev-parse HEAD)"
cp "$src"/docs/media/*.tape "$work/repo/docs/media/"
git clone -q "$pstack_src" "$work/pstack-claude"

cd "$work/repo"
HARNESS_HOME="$work/home" vhs docs/media/setup.tape
vhs docs/media/ticket.tape
cp docs/media/setup.gif docs/media/ticket.gif "$src/docs/media/"
ls -l "$src/docs/media/"*.gif
