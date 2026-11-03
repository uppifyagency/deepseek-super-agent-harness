for v in before after; do
  R=/tmp/swarm-a5fix/r1-$v; ./rig.sh $R 0.9.63
  E="env -i PATH=$R/prefix/bin:$R/bin:/usr/bin:/bin HOME=$R/user HARNESS_HOME=$R/home"
  CLI=/tmp/swarm-a5fix/$v/harness/src/cli.ts
  A="--yes --repo o/n --allow v --label it.delera.harness.k1 --keychain svc-k1 --pstack $R/p/plugins/pstack"
  echo "== $v, doctor: radice con solo mkdir -p $R/p/plugins/pstack"
  mkdir -p $R/p/plugins/pstack
  printf '{"repos":["o/n"],"allowedActors":["v"],"serviceLabel":"it.delera.harness.k1","botKeychainService":"svc-k1","pstackDir":"%s"}' $R/p/plugins/pstack > $R/home/config.json
  $E $R/prefix/bin/node $CLI doctor | grep pstack
  CMD=$($E $R/prefix/bin/node $CLI doctor | grep pstack | sed 's/^[^:]*: //')
  echo "== $v, il comando stampato: $CMD"; sh -c "$CMD" >/dev/null 2>$R/err; echo "exit $?"; cat $R/err | grep -v Cloning
  rm -rf $R/p; mkdir -p $R/p/plugins/pstack
  echo "== $v, setup --yes sulla stessa radice"
  $E $R/prefix/bin/node $CLI setup $A < /dev/null 2>&1 | sed -n '1,4p;/pstack/p' | grep -v Cloning | sort -u
  ls $R/p/plugins/pstack/pi/index.ts 2>&1
  echo "== $v, radice con un file"
  rm -rf $R/p; mkdir -p $R/p; echo x > $R/p/note.txt
  $E $R/prefix/bin/node $CLI setup $A < /dev/null 2>&1 | grep pstack | grep -v Cloning
  ls $R/p
done
