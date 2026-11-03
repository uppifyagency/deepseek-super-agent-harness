#!/bin/zsh
# kill9.sh <label> <home>: kill -9 the daemon, print seconds until a new pid writes heartbeat.json.
set -eu
label=$1 home=$2
old=$(launchctl print gui/$UID/$label | awk '/^\tpid =/{print $3}')
t0=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
kill -9 $old
until hb=$(cat $home/heartbeat.json 2>/dev/null) && [[ $hb == *'"pid":'* && $hb != *"\"pid\":$old,"* ]]; do sleep 0.5; done
t1=$(perl -MTime::HiRes=time -e 'printf "%.1f", time')
new=$(launchctl print gui/$UID/$label | awk '/^\tpid =/{print $3}')
echo "killed $old at $(date -r ${t0%.*} +%T), new pid $new heartbeat $hb after $(( t1 - t0 )) s"
