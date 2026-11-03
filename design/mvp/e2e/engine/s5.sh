#!/bin/zsh
# S5 driver: start, kill -9 while awaiting input, auto within 30s, SDK resume after lease, auto after lease.
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null
cd "$(dirname $0)"
cfg() { echo "{ \"resumeInFlight\": \"$1\", \"workflowNotifications\": { \"enabled\": false } }" > .atomic/extensions/workflow/config.json; }
cfg never
STORE=1 ACTION=start WF=spike-ask RUNKEY=c1 ANSWER=hang STOP_ON=never WAIT_MS=600000 node host.mjs > s5-A.log 2>&1 &
PID=$!
for i in {1..60}; do grep -q "awaiting_input" s5-A.log && break; sleep 1; done
sleep 2
RUNID=$(grep -o 'runId [0-9a-f-]*' s5-A.log | head -1 | awk '{print $2}')
echo "RUNID=$RUNID; kill -9 $PID at $(date +%s)"; kill -9 $PID
sleep 5
echo "--- B: resumeInFlight auto within 30s"
cfg auto; STORE=1 ACTION=idle ANSWER=red WAIT_MS=20000 node host.mjs > s5-B.log 2>&1; cfg never
echo "--- wait for lease"; sleep 125
echo "--- C: SDK resume after lease at $(date +%s)"
STORE=1 ACTION=resume RUNID=$RUNID ANSWER=red WAIT_MS=60000 node host.mjs > s5-C.log 2>&1
echo "--- D: resumeInFlight auto after lease"
cfg auto; STORE=1 ACTION=idle ANSWER=red WAIT_MS=60000 node host.mjs > s5-D.log 2>&1; cfg never
STORE=1 ACTION=inspect RUNID=$RUNID node host.mjs > s5-E.log 2>&1
echo done
