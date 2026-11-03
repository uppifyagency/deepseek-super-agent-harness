for v in before after; do for m in "" "--mode observe" "--mode auto"; do
  R=/tmp/swarm-a5fix/r5-$v; ./rig.sh $R 0.9.63
  mkdir -p $R/p/plugins/pstack/skills/poteto-mode $R/p/plugins/pstack/pi; touch $R/p/plugins/pstack/skills/poteto-mode/SKILL.md $R/p/plugins/pstack/pi/index.ts
  E="env -i PATH=$R/prefix/bin:$R/bin:/usr/bin:/bin HOME=$R/user HARNESS_HOME=$R/home"
  echo "== $v, setup --yes $m su una home vuota"
  echo fake_token_for_tests | $E $R/prefix/bin/node /tmp/swarm-a5fix/$v/harness/src/cli.ts setup --yes $m --repo o/n --allow v --label it.delera.harness.k5 --keychain svc-k5 --pstack $R/p/plugins/pstack > $R/out 2>&1; echo "exit $?"
  grep -E "config.json|Unknown option" $R/out | head -1
  $E $R/prefix/bin/node /tmp/swarm-a5fix/$v/harness/src/cli.ts status 2>&1 | grep '"mode"'
done; done
