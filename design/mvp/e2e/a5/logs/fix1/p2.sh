for v in before after; do
 for case in "0.9.64 off" "0.10.0 on"; do
  set -- $case; R=/tmp/swarm-a5fix/r2-$v; ./rig.sh $R $1
  P=$R/bin:/usr/bin:/bin; [ $2 = on ] && P=$R/prefix/bin:$P
  echo "== $v, Atomic $1 installato, atomic nel PATH: $2"
  env -i PATH=$P HOME=$R/user HARNESS_HOME=$R/home $R/prefix/bin/node /tmp/swarm-a5fix/$v/harness/src/cli.ts setup --yes --repo o/n --allow v --label it.delera.harness.k2 --keychain svc-k2 --pstack $R/p/plugins/pstack < /dev/null > $R/out 2>&1; c=$?; sed -n 3p $R/out
  echo "exit $c; chiamate a npm:"; grep '^npm' $R/calls.log 2>/dev/null || echo "(nessuna)"
 done
done
