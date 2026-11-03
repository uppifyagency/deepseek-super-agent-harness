---- MODULE worker_slots ----
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Runs, SilentRuns, Starters, MaxWorkers, SilentYields

VARIABLES st, seq, workers, picks, busy, jumped

vars == <<st, seq, workers, picks, busy, jumped>>

None == "none"

TypeOK ==
  /\ st \in [Runs -> {"intended", "bound", "ended"}]
  /\ seq \in [Runs -> 0..Cardinality(Runs)]
  /\ workers \in [Runs -> 0..2]
  /\ busy \in [Starters -> Runs \cup {None}]
  /\ jumped \in BOOLEAN

Orders == {f \in [Runs -> 1..Cardinality(Runs)] : \A a, b \in Runs : a # b => f[a] # f[b]}

Init ==
  /\ st = [r \in Runs |-> "intended"]
  /\ seq \in Orders
  /\ workers = [r \in Runs |-> 0]
  /\ picks = [s \in Starters |-> <<>>]
  /\ busy = [s \in Starters |-> None]
  /\ jumped = FALSE

Bound == {r \in Runs : st[r] = "bound"}
Waiting == {r \in Runs : st[r] = "intended"}
Free == MaxWorkers - Cardinality(Bound)

Rank(r) == (IF SilentYields /\ r \in SilentRuns THEN 10 ELSE 0) + seq[r]

Ordered(S) ==
  CHOOSE f \in [1..Cardinality(S) -> S] :
    \A i, j \in 1..Cardinality(S) : i < j => Rank(f[i]) < Rank(f[j])

First(f, n) == [i \in 1..(IF n < Len(f) THEN n ELSE Len(f)) |-> f[i]]

Range(f) == {f[i] : i \in DOMAIN f}

PickRuns(s) ==
  /\ picks[s] = <<>>
  /\ busy[s] = None
  /\ Free > 0
  /\ Waiting # {}
  /\ LET chosen == First(Ordered(Waiting), Free)
         left == Waiting \ Range(chosen)
     IN /\ picks' = [picks EXCEPT ![s] = chosen]
        /\ jumped' = (jumped \/ ((Range(chosen) \cap SilentRuns # {}) /\ (left \ SilentRuns # {})))
  /\ UNCHANGED <<st, seq, workers, busy>>

Launch(s) ==
  /\ busy[s] = None
  /\ picks[s] # <<>>
  /\ LET r == Head(picks[s]) IN
       /\ workers' = [workers EXCEPT ![r] = @ + 1]
       /\ busy' = [busy EXCEPT ![s] = r]
  /\ picks' = [picks EXCEPT ![s] = Tail(@)]
  /\ UNCHANGED <<st, seq, jumped>>

RunBound(s) ==
  /\ busy[s] # None
  /\ LET r == busy[s] IN
       st' = [st EXCEPT ![r] = IF @ = "ended" THEN "ended" ELSE "bound"]
  /\ busy' = [busy EXCEPT ![s] = None]
  /\ UNCHANGED <<seq, workers, picks, jumped>>

LaunchFails(s) ==
  /\ busy[s] # None
  /\ LET r == busy[s] IN
       /\ workers' = [workers EXCEPT ![r] = @ - 1]
       /\ st' = [st EXCEPT ![r] = "ended"]
  /\ busy' = [busy EXCEPT ![s] = None]
  /\ UNCHANGED <<seq, picks, jumped>>

RunEnds(r) ==
  /\ st[r] = "bound"
  /\ workers[r] > 0
  /\ \A s \in Starters : busy[s] # r
  /\ workers' = [workers EXCEPT ![r] = @ - 1]
  /\ st' = [st EXCEPT ![r] = "ended"]
  /\ UNCHANGED <<seq, picks, busy, jumped>>

OrphanEnds(r) ==
  /\ st[r] = "ended"
  /\ workers[r] > 0
  /\ \A s \in Starters : busy[s] # r
  /\ workers' = [workers EXCEPT ![r] = @ - 1]
  /\ UNCHANGED <<st, seq, picks, busy, jumped>>

Done ==
  /\ \A r \in Runs : st[r] = "ended" /\ workers[r] = 0
  /\ \A s \in Starters : busy[s] = None /\ picks[s] = <<>>
  /\ UNCHANGED vars

Next ==
  \/ \E r \in Runs : RunEnds(r) \/ OrphanEnds(r)
  \/ \E s \in Starters : PickRuns(s) \/ Launch(s) \/ RunBound(s) \/ LaunchFails(s)
  \/ Done

Spec == Init /\ [][Next]_vars

TotalWorkers == Cardinality({rw \in Runs \X {1, 2} : rw[2] <= workers[rw[1]]})

WithinCap == TotalWorkers <= MaxWorkers

OneWorkerPerRun == \A r \in Runs : workers[r] <= 1

VisibleFirst == ~jumped

====
