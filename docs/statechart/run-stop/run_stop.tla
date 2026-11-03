---- MODULE run_stop ----
EXTENDS Naturals

CONSTANTS MaxAttempts, MaxJudgements, DaemonChecksGate, DaemonDedupes

VARIABLES attempt, run, gate, snapshot, judged, handled, stops, stopWhileGate, outcome

vars == <<attempt, run, gate, snapshot, judged, handled, stops, stopWhileGate, outcome>>

TypeOK ==
  /\ attempt \in 1..MaxAttempts
  /\ run \in {"working", "asking", "ended"}
  /\ gate \in {"none", "question", "budget"}
  /\ snapshot \in 0..MaxAttempts
  /\ judged \in 0..MaxJudgements
  /\ handled \in 0..MaxJudgements
  /\ stops \in 0..MaxJudgements
  /\ stopWhileGate \in BOOLEAN
  /\ outcome \in {"none", "done", "budget", "stopped", "declined"}

Init ==
  /\ attempt = 1
  /\ run = "working"
  /\ gate = "none"
  /\ snapshot = 0
  /\ judged = 0
  /\ handled = 0
  /\ stops = 0
  /\ stopWhileGate = FALSE
  /\ outcome = "none"

WorkerAsks ==
  /\ run = "working"
  /\ run' = "asking"
  /\ gate' = "question"
  /\ UNCHANGED <<attempt, snapshot, judged, handled, stops, stopWhileGate, outcome>>

GateAnswered ==
  /\ gate = "question"
  /\ run' = "working"
  /\ gate' = "none"
  /\ UNCHANGED <<attempt, snapshot, judged, handled, stops, stopWhileGate, outcome>>

WatchdogReads ==
  /\ run = "working"
  /\ gate = "none"
  /\ snapshot = 0
  /\ judged < MaxJudgements
  /\ snapshot' = attempt
  /\ UNCHANGED <<attempt, run, gate, judged, handled, stops, stopWhileGate, outcome>>

WatchdogJudgesStuck ==
  /\ snapshot # 0
  /\ snapshot' = 0
  /\ judged' = IF snapshot = attempt THEN judged + 1 ELSE judged
  /\ UNCHANGED <<attempt, run, gate, handled, stops, stopWhileGate, outcome>>

WatchdogJudgesProgressing ==
  /\ snapshot # 0
  /\ snapshot' = 0
  /\ UNCHANGED <<attempt, run, gate, judged, handled, stops, stopWhileGate, outcome>>

MayStop ==
  /\ run # "ended"
  /\ DaemonChecksGate => gate = "none"
  /\ DaemonDedupes => stops = 0

DaemonReadsJudgement ==
  /\ handled < judged
  /\ handled' = handled + 1
  /\ IF MayStop
       THEN /\ stops' = stops + 1
            /\ stopWhileGate' = (stopWhileGate \/ gate # "none")
       ELSE UNCHANGED <<stops, stopWhileGate>>
  /\ UNCHANGED <<attempt, run, gate, snapshot, judged, outcome>>

EngineStopsRun ==
  /\ stops > 0
  /\ run # "ended"
  /\ run' = "ended"
  /\ gate' = "none"
  /\ outcome' = "stopped"
  /\ UNCHANGED <<attempt, snapshot, judged, handled, stops, stopWhileGate>>

RunFinishes ==
  /\ run = "working"
  /\ run' = "ended"
  /\ outcome' = "done"
  /\ UNCHANGED <<attempt, gate, snapshot, judged, handled, stops, stopWhileGate>>

BudgetRunsOut ==
  /\ run = "working"
  /\ run' = "ended"
  /\ gate' = "budget"
  /\ outcome' = "budget"
  /\ UNCHANGED <<attempt, snapshot, judged, handled, stops, stopWhileGate>>

VladRaisesBudget ==
  /\ gate = "budget"
  /\ attempt < MaxAttempts
  /\ attempt' = attempt + 1
  /\ run' = "working"
  /\ gate' = "none"
  /\ judged' = 0
  /\ handled' = 0
  /\ stops' = 0
  /\ outcome' = "none"
  /\ UNCHANGED <<snapshot, stopWhileGate>>

VladDeclinesBudget ==
  /\ gate = "budget"
  /\ gate' = "none"
  /\ outcome' = "declined"
  /\ UNCHANGED <<attempt, run, snapshot, judged, handled, stops, stopWhileGate>>

Done ==
  /\ run = "ended"
  /\ gate = "none"
  /\ UNCHANGED vars

Next ==
  \/ WorkerAsks
  \/ GateAnswered
  \/ WatchdogReads
  \/ WatchdogJudgesStuck
  \/ WatchdogJudgesProgressing
  \/ DaemonReadsJudgement
  \/ EngineStopsRun
  \/ RunFinishes
  \/ BudgetRunsOut
  \/ VladRaisesBudget
  \/ VladDeclinesBudget
  \/ Done

Spec == Init /\ [][Next]_vars

NoStopWhileGateOpen == ~stopWhileGate

OneStopPerRun == stops <= 1

====
