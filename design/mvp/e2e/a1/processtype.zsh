#!/bin/zsh
set -u
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
export HARNESS_HOME=/tmp/swarm-a1r/r9/home; L=it.delera.harness.r9; P=~/Library/LaunchAgents/$L.plist
OUT=/tmp/swarm-a1r/r9/processtype.tsv
now() { perl -MTime::HiRes=time -e 'printf "%.2f", time' }
lpid() { launchctl print gui/$UID/$L 2>/dev/null | awk '/^\tpid =/{print $3}' }
cpusecs() { ps -o time= -p $1 | awk -F'[:.]' '{ if (NF==3) print $1*60+$2+$3/100; else print $1*3600+$2*60+$3+$4/100 }' }
cd /tmp/swarm-a1r/repo/harness
node src/cli.ts service install --every 60 >/dev/null; node src/cli.ts service uninstall >/dev/null
node --input-type=module -e "import { daemonJob, renderPlist } from './src/launchd.ts'; import { loadConfig } from './src/config.ts'; process.stdout.write(renderPlist(daemonJob(loadConfig(), 60)))" > /tmp/swarm-a1r/r9/base.plist
echo "type\tn\tfirst_hb_s\tcpu_60_360_s\tcpu_pct\trss_kb\tcpu_0_60_s" > $OUT
n=0
for t in Background Standard Background Standard; do
  n=$((n+1))
  sed -E "s|<key>ProcessType</key><string>[A-Za-z]+</string>|<key>ProcessType</key><string>$t</string>|" /tmp/swarm-a1r/r9/base.plist > $P
  grep -q "<string>$t</string>" $P || { echo "no $t in plist"; exit 1; }
  rm -f $HARNESS_HOME/heartbeat.json
  t0=$(now); launchctl bootstrap gui/$UID $P
  pid=$(lpid); until [[ -n $pid ]]; do sleep 0.1; pid=$(lpid); done
  until [[ -f $HARNESS_HOME/heartbeat.json ]]; do sleep 0.1; done; hb=$(( $(now) - t0 ))
  while (( $(now) - t0 < 60 )); do sleep 0.5; done; c1=$(cpusecs $pid)
  while (( $(now) - t0 < 360 )); do sleep 0.5; done; c2=$(cpusecs $pid); rss=$(ps -o rss= -p $pid | xargs)
  [[ $(lpid) == $pid ]] || echo "pid changed in $t$n"
  echo "$t\t$n\t$hb\t$(( c2 - c1 ))\t$(( (c2 - c1) / 3 ))\t$rss\t$c1" >> $OUT
  launchctl bootout gui/$UID/$L; while launchctl print gui/$UID/$L >/dev/null 2>&1; do sleep 0.25; done
done
rm -f $P
cat $OUT
