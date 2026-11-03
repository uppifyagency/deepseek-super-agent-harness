#!/bin/zsh
# setup-proof.sh <checkout>: harness setup --yes from a /tmp clone of HEAD installs the daemon and the watchdog,
# doctor reports both, service uninstall removes both. Test home, label, handle and Keychain service, all removed on exit.
set -eu
src=$1
work=/tmp/sah-int-setup
label=it.delera.harness.si
watchdog=it.delera.harness.watchdog.si
keychain=harness-bot-github-test-int
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 26.13.0 >/dev/null
export HARNESS_HOME=$work/home
cli=$work/repo/harness/src/cli.ts
domain=gui/$(id -u)
show() {
  for l in $label $watchdog; do
    print -- "--- launchctl print $l"
    launchctl print $domain/$l 2>&1 | grep -E '^\S|^\s+(state|pid|run interval|runs|last exit code) =' || print "exit $?"
    print -- "--- plist $l"
    ls ~/Library/LaunchAgents/$l.plist 2>&1 || true
  done
}
cleanup() {
  [ -f $cli ] && node $cli service uninstall >/dev/null 2>&1 || true
  security delete-generic-password -s $keychain >/dev/null 2>&1 || true
  rm -rf $work
}
trap cleanup EXIT
rm -rf $work
mkdir -p $HARNESS_HOME
git clone -q "$src" $work/repo
git -C $work/repo checkout -q "$(git -C "$src" rev-parse HEAD)"
set +e
print "# harness setup --yes, head $(git -C $work/repo rev-parse --short HEAD), $(date -u +%FT%TZ)"
cd $work/repo/harness
printf 'not_a_real_token\n' | node $cli setup --yes --repo uppifyagency/harness-sandbox --allow uppifyagency --handle /harness-si \
  --label $label --keychain $keychain --pstack $HOME/src/pstack-claude/plugins/pstack
print "setup exit $?"
show
print -- "--- harness doctor"
node $cli doctor; print "doctor exit $?"
print -- "--- harness service uninstall"
node $cli service uninstall
show
security delete-generic-password -s $keychain >/dev/null 2>&1 && print "keychain $keychain removed"
