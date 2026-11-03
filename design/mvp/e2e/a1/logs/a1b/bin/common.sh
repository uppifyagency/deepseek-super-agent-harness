# helpers after env.sh
evs() { q "select at,kind,substr(json_extract(draft,'\$.body'),1,220) from event where kind like 'run.%' order by seq" }
pid() { launchctl print gui/$UID/$L 2>/dev/null | awk '/^\tpid = /{print $3}' }
rs() { echo "\$ $(ts) service restart (pid before $(pid))"; node src/cli.ts service restart; echo "pid after $(pid)" }
finish() { # wait for terminal: a run.ended with done, or a non-retryable fail, or timeout seconds $1
  local dl=$(( $(date +%s) + $1 ))
  until [[ -n $(q "select 1 from event where kind='run.ended' and json_extract(draft,'\$.body.outcome.kind')='done'") ]] || (( $(date +%s) > dl )); do
    grep -q -i 'usage limit' $HARNESS_HOME/logs/*.log 2>/dev/null && { echo "USAGE LIMIT seen"; break; }
    sleep 10; done
}
report() {
  echo "\$ $(ts) run events"; evs
  echo "\$ run.intended attempts"; q "select json_extract(draft,'\$.body.attempt') from event where kind='run.intended'"
  echo "\$ run.ended count per run"; q "select json_extract(draft,'\$.body.run'), json_extract(draft,'\$.body.outcome.kind'), count(*) from event where kind='run.ended' group by 1,2"
  echo "\$ engine.log"; cut -c1-300 $HARNESS_HOME/logs/engine.log
  echo "\$ daemon.log tail"; tail -25 $HARNESS_HOME/logs/daemon.log | cut -c1-250
  echo "\$ PRs for issue #$ISSUE"; gh pr list -R $R --state all --limit 40 --json number,author,state,files,headRefName --jq ".[] | select([.files[].path] | any(test(\"somma-$N\"))) | \"#\\(.number) \\(.author.login) \\(.state) \\(.headRefName) \\([.files[].path])\""
  echo "\$ issue #$ISSUE comments"; gh issue view $ISSUE -R $R --json comments --jq '.comments[] | "\(.createdAt) \(.author.login): \(.body | gsub("\n";" / ") | .[0:200])"'
}
ticket() { # create issue, sets ISSUE
  ISSUE=$(gh issue create -R $R --title "A1b verifica $N" --body "/harness-$N crea scripts/somma-$N.sh che stampa la somma dei due argomenti, con un test scripts/test-somma-$N.sh" | grep -o '[0-9]*$')
  echo "\$ $(ts) issue #$ISSUE created"
}
