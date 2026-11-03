#!/bin/zsh
zmodload zsh/datetime
n=${1:-12}
print "# gh $(gh --version | awk 'NR==1 {print $3}'), macOS $(sw_vers -productVersion), $(date -u +%FT%TZ), doctor timeout 2.5 s"
slow=0
for i in {1..$n}; do
  t0=$EPOCHREALTIME
  gh auth status >/dev/null 2>&1
  rc=$?
  d=$(( EPOCHREALTIME - t0 ))
  (( d > 2.5 )) && (( slow++ ))
  printf 'run %2d  %6.2f s  exit %d\n' $i $d $rc
done
print "# over 2.5 s: $slow of $n"
